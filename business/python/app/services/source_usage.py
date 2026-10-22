"""Track references actually read during writing, rather than every uploaded file."""
from pathlib import Path
from .. import artifact_store
from . import build_state, page_flow


def access(tid, path):
    path = Path(path).resolve()
    sources = artifact_store.sources_dir(tid).resolve()
    parsed = (artifact_store.work_dir(tid) / 'parse').resolve()
    name = None
    if path.parent == sources:
        name = path.name
    elif path.is_relative_to(parsed) and len(path.relative_to(parsed).parts) >= 2:
        name = path.relative_to(parsed).parts[0]
    if name and (sources / name).is_file():
        return {'name': name, 'sha256': page_flow.file_hash(sources / name)}


def record_read(tid, session, source):
    if not session or not source:
        return
    with artifact_store.write_lock():
        value = build_state.read(tid)
        record_read_value(value, session, source)
        build_state.save(tid, value)


def record_read_value(value, session, source):
    if not session or not source:
        return
    reads = value.setdefault('source_reads', {}).setdefault(session, {})
    old = reads.get(source['name'])
    if old is not None and old != source['sha256']:
        raise ValueError('制作期间已读取参考来源发生变化，请重新核对')
    reads[source['name']] = source['sha256']


def inherit(value, session, parent, seed):
    reads = value.setdefault('source_reads', {})
    if seed and session in reads:
        return
    merged = dict(reads.get(session, {}))
    for name, sha in reads.get(parent, {}).items():
        if name in merged and merged[name] != sha:
            raise ValueError('派发上下文包含不同参考来源版本，请重新核对')
        merged[name] = sha
    reads[session] = merged


def current(tid, names):
    sources = artifact_store.sources_dir(tid)
    return {name: page_flow.file_hash(sources / name) if (sources / name).is_file() else None for name in names}


def attach(tid, value, path, session, replace):
    dependencies = value.setdefault('source_dependencies', {})
    old = {} if replace else dependencies.get(path, {})
    merged = dict(old)
    for name, sha in value.get('source_reads', {}).get(session, {}).items():
        if name in merged and merged[name] != sha:
            raise ValueError('局部修订仍保留旧参考来源，请完整重建本章后重新校验')
        merged[name] = sha
    if current(tid, merged) != merged:
        raise ValueError('制作期间已采用参考来源发生变化，请重新核对')
    if merged:
        dependencies[path] = merged
    else:
        dependencies.pop(path, None)


def basis(tid, paths):
    dependencies = build_state.read(tid).get('source_dependencies', {})
    return {path: current(tid, dependencies[path]) for path in paths if path in dependencies}
