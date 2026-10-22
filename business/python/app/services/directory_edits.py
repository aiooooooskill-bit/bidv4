"""人工目录保存：保留明确的章节改名关系，保存即成为制作依据。"""
import json
import hashlib
import unicodedata
from contextlib import contextmanager
from tempfile import mkdtemp
from pathlib import Path

from pydantic import BaseModel

from .. import artifact_store
from ..tools.body_contract import document_name, multi_volume, volume_key, sanitize_name
from ..work_paths import resolve_work_path
from . import build_state
from .errors import BusinessError


class SectionRename(BaseModel):
    volume: str
    from_title: str
    to_title: str


def user_save_path(row):
    return artifact_store.artifact_dir(row['artifact_id'], row) / 'user-save.json'


def user_save(row):
    file = user_save_path(row)
    saved = json.loads(file.read_text()) if file.is_file() else None
    content = artifact_store.read_content_resolved(row['artifact_id'], row)
    return saved if saved and saved['content_seq'] == row['content_seq'] and content is not None and saved['content_sha256'] == hashlib.sha256(content.encode()).hexdigest() else None


def _nodes(content):
    def walk(nodes):
        for node in nodes:
            yield node
            yield from walk(node.get('children') or [])
    return [(document_name(doc), node) for doc in content['response_documents'] for node in walk(doc.get('directory') or [])]


def _body_path(content, volume, title):
    return 'body/' + (volume_key(volume) + '/' if multi_volume(content) else '') + sanitize_name(title) + '.docx'


def _path_key(path):
    """保留文件名写法，按 Unicode 等价、不区分大小写检查跨平台冲突。"""
    return unicodedata.normalize('NFC', path.casefold())


def rename_paths(previous, content, renames, existing_paths):
    """只使用编辑器记录的明确改名，不按相似度猜测章节归属。"""
    before, after = _nodes(previous), _nodes(content)
    existing_keys = {_path_key(path) for path in existing_paths}
    if any(not node['目录名称'].strip() for _, node in after):
        raise BusinessError(422, '章节标题不能为空')
    result = {}
    destinations = set()
    for rename in renames:
        old = [(vol, node) for vol, node in before if vol == rename.volume and node['目录名称'] == rename.from_title]
        new = [(vol, node) for vol, node in after if vol == rename.volume and node['目录名称'] == rename.to_title]
        if not old or not new:
            raise BusinessError(409, '章节改名依据已变化，请读取最新目录后重新编辑：' + rename.from_title)
        source = _body_path(previous, rename.volume, rename.from_title)
        target = _body_path(content, rename.volume, rename.to_title)
        # 同名结构父节点没有正文身份；无需移动文件，也不要求其标题唯一。
        if all(node.get('children') for _, node in old) and not ({_path_key(source), _path_key(target)} & existing_keys):
            continue
        if len(old) != 1 or len(new) != 1:
            raise BusinessError(409, '章节改名依据已变化，请读取最新目录后重新编辑：' + rename.from_title)
        if _path_key(source) in {_path_key(path) for path in result} or _path_key(target) in destinations:
            raise BusinessError(422, '章节文件名重复，请调整标题：' + rename.to_title)
        result[source] = target
        destinations.add(_path_key(target))
    # 单册/多册变化也按未改名的同册同名节点同步目录，已有父节点正文一并保留。
    renamed = {(r.volume, r.from_title) for r in renames}
    for volume, node in before:
        title = node['目录名称']
        if node.get('children') and _path_key(_body_path(previous, volume, title)) not in existing_keys:
            continue
        if (volume, title) not in renamed and any(vol == volume and n['目录名称'] == title for vol, n in after):
            source, target = _body_path(previous, volume, title), _body_path(content, volume, title)
            if source != target:
                result[source] = target
    # 叶子必定需要正文；父节点仅在持有正文时占用文件名。考虑本次改名后的落点。
    mapped_keys = {_path_key(source): _path_key(target) for source, target in result.items()}
    body_keys = {mapped_keys.get(_path_key(path), _path_key(path)) for path in existing_paths}
    body_keys.update(_path_key(_body_path(content, vol, node['目录名称']))
                     for vol, node in after if not node.get('children'))
    paths = set()
    for volume, node in after:
        key = _path_key(_body_path(content, volume, node['目录名称']))
        if key in body_keys:
            if key in paths:
                raise BusinessError(422, '同册章节文件名重复，请调整标题：' + node['目录名称'])
            paths.add(key)
    return {source: target for source, target in result.items() if source != target}


@contextmanager
def preserve_bodies(tid, previous, content, renames):
    """调用方持发布锁；改名支持互换，异常时还原文件及制作记录。"""
    root = artifact_store.work_dir(tid)
    state_file = root / 'body/.build-state.json'
    original_state = state_file.read_bytes() if state_file.is_file() else None
    state = build_state.read(tid)
    owned = set().union(*(state.get(key, {}) for key in ('sections', 'pending_sections', 'asset_dependencies', 'section_titles')))
    existing = owned | {path.relative_to(root).as_posix() for path in (root / 'body').rglob('*.docx') if path.is_file()}
    mapping = rename_paths(previous, content, renames, existing)
    mapped_paths = {_path_key(source): target for source, target in mapping.items()}
    existing_keys = {_path_key(path) for path in existing}
    source_keys = {_path_key(path) for path in mapping}
    files = {}
    for source, target in mapping.items():
        old, new = resolve_work_path(tid, source), resolve_work_path(tid, target)
        if (new.exists() or _path_key(target) in existing_keys) and _path_key(target) not in source_keys:
            raise BusinessError(409, '改名后的正文文件已存在，未覆盖：' + target)
        if old.is_file():
            files[source] = target
    staged, placed = {}, set()
    temporary = Path(mkdtemp(prefix='.directory-edit-', dir=root))
    try:
        for index, source in enumerate(files):
            backup = temporary / str(index)
            (root / source).rename(backup)
            staged[source] = backup
        for source, target in files.items():
            (root / target).parent.mkdir(parents=True, exist_ok=True)
            staged[source].rename(root / target)
            placed.add(source)
        for key in ('sections', 'pending_sections', 'asset_dependencies', 'section_titles'):
            if key in state:
                state[key] = {mapped_paths.get(_path_key(path), path): value for path, value in state[key].items()}
        for rename in renames:
            target = _body_path(content, rename.volume, rename.to_title)
            if (root / target).is_file():
                titles = state.setdefault('section_titles', {}).setdefault(target, [])
                if rename.from_title not in titles:
                    titles.append(rename.from_title)
        if mapping or renames:
            build_state.save(tid, state)
        yield
    except BaseException:
        try:
            for source in placed:
                (root / files[source]).rename(staged[source])
            for source, backup in staged.items():
                backup.rename(root / source)
            if original_state is None:
                state_file.unlink(missing_ok=True)
            else:
                artifact_store._atomic_write(state_file, original_state.decode())
        except BaseException as recovery_error:
            raise BusinessError(500, '目录保存未完成，正文保全目录已保留：' + str(temporary)) from recovery_error
        temporary.rmdir()
        raise
    else:
        temporary.rmdir()
