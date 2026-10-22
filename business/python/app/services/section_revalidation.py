"""写作阶段的校验登记：修订可核验保留，失败退回待校验；不改原稿。"""
import json
from copy import deepcopy
from .. import artifact_store, config
from . import build_state, page_flow


def _admission(tid, session, path, *, inspecting=False):
    if not session:
        return None
    folder = config.data_dir() / 'actions' / tid
    latest = folder / 'latest.json'
    if not latest.is_file():
        return None
    record = json.loads(latest.read_text())
    kinds = ('body', 'revise', 'build') if inspecting else ('revise',)
    selected = path in record.get('section_paths', []) or (inspecting and record.get('kind') == 'build' and session == record.get('session_id'))
    if (record.get('kind') not in kinds or record.get('stopped_at')
            or (record.get('outcome') or {}).get('state') in ('completed', 'failed', 'stopped')
            or not selected):
        return None
    if session != record['session_id']:
        writer = folder / 'writers' / (session + '.json')
        if not writer.is_file():
            return None
        assignment = json.loads(writer.read_text())
        if (assignment.get('action_id') != record['action_id'] or assignment.get('parent_id') != record['session_id']
                or assignment.get('status') != 'active' or path not in assignment.get('section_paths', [])):
            return None
    return record['action_id']


def capture(tid, session, path):
    action = _admission(tid, session, path, inspecting=True)
    section = next((s for s in build_state.sections(tid) if s['path'] == path), None)
    target = artifact_store.work_dir(tid) / path
    if section is None or not target.is_file():
        return None
    basis = build_state.section_basis(tid, section)
    stored = build_state.read(tid)
    current = stored.get('sections', {}).get(path) == basis
    return {'action_id': action, 'hash': page_flow.file_hash(target), 'basis': basis,
            'retain': bool(_admission(tid, session, path)) and not current,
            'was_ready': current and path not in stored.get('pending_sections', {})}


def accept(tid, session, path, captured):
    if captured is None:
        return False
    from ..tools.docx_ops import _docx_path_lock
    target = artifact_store.work_dir(tid) / path
    with artifact_store.write_lock(), _docx_path_lock(target):
        section = next(s for s in build_state.sections(tid) if s['path'] == path)
        if (_admission(tid, session, path, inspecting=True) != captured['action_id']
                or page_flow.file_hash(target) != captured['hash']
                or build_state.section_basis(tid, section) != captured['basis']):
            raise ValueError('核验期间动作、原稿或依据已变化，未登记；请按当前内容重新核验')
        previous = deepcopy(build_state.read(tid))
        try:
            # 复用既有来源/资料版本检查和记账，不修改DOCX，也不接纳变化的旧来源。
            if captured['retain']:
                build_state._record_write_locked(tid, section, deepcopy(previous), session)
            build_state._record_validation_locked(tid, path, section)
            value = build_state.read(tid)
            basis = build_state.section_basis(tid, section)
            if (captured['action_id'] and value.get('sections', {}).get(path) == basis
                    and path not in value.get('pending_sections', {})):
                previous_proof = value.get('section_validations', {}).get(path, {})
                actions = (previous_proof.get('action_ids', []) if previous_proof.get('hash') == captured['hash']
                           and previous_proof.get('basis') == basis else [])
                value.setdefault('section_validations', {})[path] = {
                    'action_ids': list(dict.fromkeys([*actions, captured['action_id']])),
                    'hash': captured['hash'], 'basis': basis}
                build_state.save(tid, value)
        except Exception:
            build_state.save(tid, previous)
            raise
    return captured['retain']


def reject(tid, session, path, captured):
    """本轮明确范围内的失败验收撤销当前就绪；不改正文、不接纳过期依据。"""
    if captured is None or not captured['action_id'] or not captured['was_ready']:
        return False
    from ..tools.docx_ops import _docx_path_lock
    target = artifact_store.work_dir(tid) / path
    with artifact_store.write_lock(), _docx_path_lock(target):
        section = next(s for s in build_state.sections(tid) if s['path'] == path)
        if (_admission(tid, session, path, inspecting=True) != captured['action_id']
                or page_flow.file_hash(target) != captured['hash']
                or build_state.section_basis(tid, section) != captured['basis']):
            raise ValueError('核验期间动作、原稿或依据已变化，未登记失败结果；请按当前内容重新核验')
        value = build_state.read(tid)
        if path in value.get('pending_sections', {}):
            return False
        value.setdefault('pending_sections', {})[path] = {'basis': captured['basis'], 'hash': captured['hash']}
        build_state.save(tid, value)
    return True
