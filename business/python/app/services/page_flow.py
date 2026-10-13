import hashlib,json
from pathlib import Path
from functools import lru_cache
from .. import artifact_store,db
from ..tools.body_contract import iter_leaves,multi_volume,sanitize_name
from .errors import BusinessError
def digest(value):
    return hashlib.sha256(json.dumps(value, ensure_ascii=False, sort_keys=True).encode()).hexdigest()

@lru_cache(maxsize=256)
def _file_hash(path: str, modified: int, size: int):
    h = hashlib.sha256()
    with open(path, 'rb') as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b''):
            h.update(chunk)
    return h.hexdigest()

def file_hash(path: Path):
    info = path.stat()
    return _file_hash(str(path), info.st_mtime_ns, info.st_size)

def require_task(tid):
    task = db.get_task(tid)
    if not task:
        raise BusinessError(404, '任务不存在')
    return task

def directory(tid):
    row = db.find_artifact_index('tender.directory', 'tender-response-docs', 1, task_id=tid)
    if not row:
        return None
    path = artifact_store.resolved_content_path(row['artifact_id'], row)
    if not path or not path.is_file():
        return None
    return {'artifact_id': row['artifact_id'], 'content_seq': row['content_seq'], 'content': json.loads(path.read_text())}

def files(tid):
    root = artifact_store.work_dir(tid)
    from .build_state import guide_registry
    result = []
    for folder in ('analysis', 'body'):
        for p in sorted((root / folder).glob('*.md')):
            item = {'path': p.relative_to(root).as_posix(), 'content': p.read_text(), 'hash': file_hash(p), 'modified_at': p.stat().st_mtime_ns / 1_000_000}
            if item['path'] == 'body/写作指引.md':
                registry = guide_registry(tid, item['hash'])
                if registry is not None:
                    item['registry'] = registry
            result.append(item)
    return result

def source_selection(tid):
    path = artifact_store.work_dir(tid) / 'parse/sources.json'
    return json.loads(path.read_text()) if path.is_file() else {'main': '', 'supplements': [], 'excluded': []}

def set_sources(tid, main_file, supplements):
    from .edit_guard import require_idle
    from ..parse import write_atomic
    require_task(tid)
    require_idle(tid)
    names = {p.name for p in artifact_store.sources_dir(tid).iterdir() if p.is_file() and not p.name.startswith('.')}
    if not isinstance(main_file, str) or not isinstance(supplements, list) or any(not isinstance(s, str) for s in supplements):
        raise BusinessError(422, '来源选择参数无效')
    selected = [main_file, *supplements]
    if not main_file or len(set(selected)) != len(selected) or any(n not in names for n in selected):
        raise BusinessError(422, '请选择已上传的招标原文与补充来源')
    selection = {'main': main_file, 'supplements': [{'file': s, 'role': '补充文件'} for s in supplements], 'excluded': sorted(names - set(selected))}
    write_atomic(artifact_store.work_dir(tid) / 'parse/sources.json', json.dumps(selection, ensure_ascii=False, indent=2))
    return selection

def input_versions(tid):
    root = artifact_store.work_dir(tid)
    md = {p.relative_to(root).as_posix(): file_hash(p) for folder in ('analysis', 'body') for p in (root / folder).glob('*.md')}
    source = {p.name: file_hash(p) for p in artifact_store.sources_dir(tid).glob('*') if p.is_file() and (not p.name.startswith('.'))}
    analysis = {k: v for k, v in md.items() if k.startswith('analysis/')}
    source_input = {'sources': source, 'source_selection': source_selection(tid)}
    current = directory(tid)
    content = current['content'] if current else None
    from .bidder import basis
    shared = {**source_input, 'analysis': analysis, 'directory': content, 'bidder':basis(tid)}
    from . import build_state
    from .asset_usage import basis as asset_basis
    planning = {**shared, 'assets':asset_basis(tid,['guide']), 'directory': {k: v for k, v in content.items() if k != 'numbering'} if content else None}
    body_input = {**shared, 'assets':asset_basis(tid,['guide','promises',*[s['path'] for s in build_state.sections(tid)]]), 'guide': md.get('body/写作指引.md'), 'promises': md.get('body/关键事实与承诺.md')}
    bodies = {p.relative_to(root).as_posix(): file_hash(p) for p in (root / 'body').rglob('*.docx')}
    return {'analyse': digest(source_input), 'outline': digest({**source_input, 'analysis': analysis}), 'guide': digest(planning), 'promises': digest({**planning, 'assets':asset_basis(tid,['guide','promises']), 'guide': md.get('body/写作指引.md')}), 'body': digest(body_input), 'revise': digest({**body_input, 'body_files': bodies}), 'build': digest({**body_input, 'body_files': bodies})}
