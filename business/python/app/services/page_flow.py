import hashlib,json
from pathlib import Path
from functools import lru_cache
from .. import artifact_store,db
from ..tools.body_contract import iter_leaves,multi_volume,sanitize_name
from .errors import BusinessError
def digest(value):
    return hashlib.sha256(json.dumps(value, ensure_ascii=False, sort_keys=True).encode()).hexdigest()

class FileChangedDuringRead(ValueError):
    pass

@lru_cache(maxsize=256)
def _file_hash(path: str, fingerprint: tuple, cache_root: str):
    # The Python runner starts a fresh process per operation. Keep digests in the
    # existing settings store so unchanged sources are not reread on each poll.
    key = 'file-digest:' + hashlib.sha256(path.encode()).hexdigest()
    saved = db.get_setting(key)
    if saved:
        cached = json.loads(saved)
        if cached['fingerprint'] == list(fingerprint):
            return cached['sha256']
    h = hashlib.sha256()
    with open(path, 'rb') as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b''):
            h.update(chunk)
    if _fingerprint(Path(path).stat()) != fingerprint:
        raise FileChangedDuringRead('文件在读取期间已变化，请重试')
    value = h.hexdigest()
    db.set_setting(key, json.dumps({'fingerprint': fingerprint, 'sha256': value}))
    return value

def _fingerprint(info):
    return (info.st_dev, info.st_ino, info.st_size, info.st_mtime_ns, info.st_ctime_ns)

def file_hash(path: Path):
    from ..config import data_dir
    path = path.resolve()
    # Status polling can overlap a model's file write. Re-read a fresh version,
    # and still reject continuous changes rather than caching a mixed digest.
    for attempt in range(3):
        try:
            return _file_hash(str(path), _fingerprint(path.stat()), str(data_dir()))
        except FileChangedDuringRead:
            if attempt == 2:
                raise

def analysis_source_version(tid):
    return digest(source_basis(tid))

def source_basis(tid):
    """Only selected tender inputs define interpretation and downstream freshness."""
    selected = source_selection(tid)
    names = [selected['main'], *[s['file'] for s in selected['supplements']]]
    return {'main': selected['main'], 'supplements': selected['supplements'],
            'sources': {n: file_hash(artifact_store.sources_dir(tid) / n) if (artifact_store.sources_dir(tid) / n).is_file() else None
                        for n in names if n}}

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
    from .directory_edits import user_save
    saved = user_save(row)
    return {'artifact_id': row['artifact_id'], 'content_seq': row['content_seq'], 'content': json.loads(path.read_text()),
            **({'user_input_version': saved['input_version'], 'user_saved_at': saved['saved_at']} if saved else {})}

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
    from .review import selection as review_selection
    bid_names = set(review_selection(tid)['bids'])
    if bid_names.intersection([main_file, *supplements]):
        raise BusinessError(422, '投标文件不能作为招标解读依据')
    selected = ([main_file] if main_file else []) + supplements
    if len(set(selected)) != len(selected) or any(n not in names for n in selected):
        raise BusinessError(422, '请选择已上传的招标原文与补充来源')
    selection = {'main': main_file, 'supplements': [{'file': s, 'role': '补充文件'} for s in supplements], 'excluded': sorted(names - set(selected))}
    write_atomic(artifact_store.work_dir(tid) / 'parse/sources.json', json.dumps(selection, ensure_ascii=False, indent=2))
    return selection

def input_versions(tid):
    root = artifact_store.work_dir(tid)
    md = {p.relative_to(root).as_posix(): file_hash(p) for folder in ('analysis', 'body') for p in (root / folder).glob('*.md')}
    analysis = {k: v for k, v in md.items() if k.startswith('analysis/')}
    source_input = source_basis(tid)
    current = directory(tid)
    content = current['content'] if current else None
    from .bidder import basis
    shared = {**source_input, 'analysis': analysis, 'directory': content, 'bidder':basis(tid)}
    from . import build_state
    from .asset_usage import basis as asset_basis
    from .source_usage import basis as reference_basis
    paths = ['guide','promises',*[s['path'] for s in build_state.sections(tid)]]
    planning = {**shared, 'assets':asset_basis(tid,['guide']), 'references':reference_basis(tid,['guide']), 'directory': {k: v for k, v in content.items() if k != 'numbering'} if content else None}
    body_input = {**shared, 'assets':asset_basis(tid,paths), 'references':reference_basis(tid,paths), 'guide': md.get('body/写作指引.md'), 'promises': md.get('body/关键事实与承诺.md')}
    bodies = {p.relative_to(root).as_posix(): file_hash(p) for p in (root / 'body').rglob('*.docx')}
    from .review import basis
    return {'review': basis(tid), 'analyse': digest(source_input), 'outline': digest({**source_input, 'analysis': analysis}), 'guide': digest(planning), 'promises': digest({**planning, 'assets':asset_basis(tid,['guide','promises']), 'references':reference_basis(tid,['guide','promises']), 'guide': md.get('body/写作指引.md')}), 'body': digest(body_input), 'revise': digest({**body_input, 'body_files': bodies}), 'build': digest({**body_input, 'body_files': bodies})}
