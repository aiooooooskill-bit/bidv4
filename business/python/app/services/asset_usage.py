"""Versions of company assets consumed by preparation files and chapters."""
from .. import artifact_store, company_store as cs
from . import build_state


def current_assets(assets):
    result = {}
    for kid in assets:
        state = cs.asset_state(kid)
        result[kid] = {'revision': state['revision'], 'company_id': state['company_id']}
    return result


def record_read(tid, session_id, asset):
    if not session_id:
        return
    from .bidder import require_confirmed
    bidder = require_confirmed(tid)
    if asset['company_id'] != bidder['company_id']:
        raise ValueError('资料归属已变化，请重新读取')
    with artifact_store.write_lock():
        value = build_state.read(tid)
        reads = value.setdefault('asset_reads', {})
        entry = reads.get(session_id)
        if not entry or entry['bidder_revision'] != bidder['revision']:
            entry = {'bidder_revision': bidder['revision'], 'assets': {}}
        version = {'revision': asset['revision'], 'company_id': asset['company_id']}
        previous = entry['assets'].get(asset['id'])
        if previous and previous != version:
            raise ValueError('本次制作读取的资料版本已变化，请停止后重新核对')
        entry['assets'][asset['id']] = version
        reads[session_id] = entry
        build_state.save(tid, value)


def attach_reads(tid, value, path, session_id, replace=False):
    from .source_usage import attach
    attach(tid, value, path, session_id, replace)
    from .bidder import row
    bidder = row(tid)
    if not bidder or not session_id:
        return
    dependencies = value.setdefault('asset_dependencies', {})
    if replace:
        dependencies.pop(path,None)
    reads = value.get('asset_reads', {}).get(session_id)
    old = dependencies.get(path, {})
    assets = dict(old.get('assets', {}))
    if reads:
        if reads['bidder_revision'] != bidder['revision']:
            raise ValueError('本次制作读取的主体确认已变化，请停止后重新核对')
        for kid, version in reads['assets'].items():
            # A partial edit does not prove that every occurrence of an old fact was replaced.
            if kid in assets and assets[kid] != version:
                raise ValueError('局部修订仍保留旧资料版本，请完整重建本章后重新校验')
            assets[kid] = version
    if not assets:
        return
    dependencies[path] = {'bidder_revision': bidder['revision'], 'assets': assets}
    # Reject publishing an output made from a version which changed during writing.
    if any(v['company_id'] != bidder['company_id'] for v in assets.values()) or current_assets(assets) != assets:
        raise ValueError('制作期间已采用资料发生变化，请重新核对后制作')


def inherit_reads(tid, session_id, from_session_id, seed=False):
    """Carry facts passed in a delegation prompt or returned in its result."""
    from .bidder import require_confirmed
    with artifact_store.write_lock():
        value = build_state.read(tid)
        from .source_usage import inherit
        inherit(value, session_id, from_session_id, seed)
        build_state.save(tid, value)
        reads = value.setdefault('asset_reads', {})
        target = reads.get(session_id)
        if seed and target is not None:
            return
        source = reads.get(from_session_id)
        if source is None and not seed:
            return
        bidder = require_confirmed(tid)
        entries = [entry for entry in (target, source) if entry is not None]
        if any(entry['bidder_revision'] != bidder['revision'] for entry in entries):
            raise ValueError('派发上下文的主体确认已变化，请重新制作')
        assets = dict(target['assets']) if target else {}
        for kid, version in (source['assets'] if source else {}).items():
            if kid in assets and assets[kid] != version:
                raise ValueError('派发上下文包含不同资料版本，请重新核对')
            assets[kid] = version
        if any(v['company_id'] != bidder['company_id'] for v in assets.values()) or current_assets(assets) != assets:
            raise ValueError('派发期间已采用资料发生变化，请重新核对后制作')
        reads[session_id] = {'bidder_revision': bidder['revision'], 'assets': assets}
        build_state.save(tid, value)


def basis(tid, paths):
    dependencies = build_state.read(tid).get('asset_dependencies', {})
    return {path: current_assets(dependencies[path]['assets']) for path in paths if path in dependencies}


def stale(tid, bidder_revision):
    return any(entry['bidder_revision'] == bidder_revision and current_assets(entry['assets']) != entry['assets']
               for entry in build_state.read(tid).get('asset_dependencies', {}).values())
