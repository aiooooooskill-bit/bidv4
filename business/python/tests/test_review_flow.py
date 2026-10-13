import json
from copy import deepcopy
from pathlib import Path
import pytest
from docx import Document
from app import db, artifact_store, task_stage
from app.services import page_flow, review
from app.services.errors import BusinessError
from tests.util import init_env

@pytest.fixture
def setup(tmp_path, monkeypatch):
    task, _ = init_env(tmp_path, monkeypatch)
    tid = task['id']; artifact_store.ensure_task_skeleton(tid)
    for name, text in [('招标.docx', '维护服务期限为三年，须按季度提交维护记录，响应时间不超过四小时。'), ('投标.docx', '维护服务期限为一年，按季度提交维护记录，响应时间不超过四小时。')]:
        d = Document(); d.add_heading('服务要求', 1); d.add_paragraph(text * 4); d.save(artifact_store.sources_dir(tid) / name)
    page_flow.set_sources(tid, '招标.docx', [])
    review.set_input(tid, ['投标.docx'])
    review.prepare(tid)
    docs = review.documents(tid)
    def citation(doc):
        lines = Path(doc['path']).read_text().splitlines(); i = next(i for i, t in enumerate(lines) if '维护服务期限' in t)
        return {'document_id': doc['id'], 'start': i + 1, 'end': i + 1, 'quote': lines[i]}
    value = {'summary': '维护年限不符合招标要求。', 'requirements': [{'id': 'r1', 'category': '商务要求', 'text': '维护三年', 'status': 'conflict', 'tender': [citation(docs[0])], 'bid': [citation(docs[1])]}], 'issues': [{'id': 'i1', 'requirement_id': 'r1', 'severity': 'medium', 'title': '维护年限冲突', 'explanation': '投标承诺一年，要求三年。', 'suggestion': '核对实际维护年限并修订。'}], 'coverage': [{'category': c, 'note': '已阅读服务要求；本夹具未包含其余类别要求。'} for c in review.CATEGORIES], 'limitations': ['签字、盖章及证件真实性须人工确认。']}
    actions = tmp_path / 'data' / 'actions' / tid; actions.mkdir(parents=True)
    record = {'kind': 'review', 'session_id': 'review-test', 'input_version': review.basis(tid), 'created_at': 1}
    (actions / 'one.json').write_text(json.dumps(record))
    return tid, value, actions / 'one.json', record

def finish(setup):
    tid, value, path, record = setup
    review.save_report(tid, 'review-test', value); review.finish(tid, 'review-test')
    path.write_text(json.dumps({**record, 'finished_state': 'completed'}))
    return tid

def test_report_version_and_review_decision_survive_reload(setup):
    tid = finish(setup)
    assert review.snapshot(tid)['status'] == 'reviewed'
    review.decide(tid, 'review-test', 'i1', 'fixed', '已在 Word 修改，待重审')
    assert review.snapshot(tid)['report']['decisions']['i1']['status'] == 'fixed'
    assert task_stage.enrich([db.get_task(tid)])[0]['review_status'] == 'reviewed'
    p = artifact_store.sources_dir(tid) / '投标.docx'; d = Document(p); d.add_paragraph('版本更新'); d.save(p)
    assert review.snapshot(tid)['status'] == 'stale'
    with pytest.raises(BusinessError): review.decide(tid, 'review-test', 'i1', 'confirmed', '')

def test_bid_never_becomes_tender_supplement(setup):
    tid, *_ = setup
    assert page_flow.source_selection(tid)['excluded'] == ['投标.docx']
    with pytest.raises(BusinessError, match='投标文件不能'): page_flow.set_sources(tid, '招标.docx', ['投标.docx'])
    with pytest.raises(BusinessError): review.set_input(tid, ['招标.docx'])

@pytest.mark.parametrize('invalid', ['quote', 'lines', 'role', 'requirement', 'no-bid', 'coverage', 'no-issue'])
def test_invalid_evidence_or_incomplete_report_rejected(setup, invalid):
    tid, value, *_ = setup; value = deepcopy(value); req = value['requirements'][0]
    if invalid == 'quote': req['bid'][0]['quote'] = '这段内容原文不存在'
    if invalid == 'lines': req['bid'][0]['end'] = 999
    if invalid == 'role': req['bid'][0]['document_id'] = 'tender-0'
    if invalid == 'requirement': value['issues'][0]['requirement_id'] = 'unknown'
    if invalid == 'no-bid': req['bid'] = []
    if invalid == 'coverage': value['coverage'][0]['category'] = value['coverage'][1]['category']
    if invalid == 'no-issue': value['issues'] = []
    with pytest.raises(ValueError): review.save_report(tid, 'review-test', value)
    assert review.snapshot(tid)['status'] != 'reviewed'

def test_saved_candidate_is_not_reviewed_until_completed(setup):
    tid, value, path, record = setup
    review.save_report(tid, 'review-test', value)
    assert review.snapshot(tid)['report'] is None
    path.write_text(json.dumps({**record, 'finished_state': 'failed'}))
    assert review.snapshot(tid)['status'] == 'failed'
    path.write_text(json.dumps({**record, 'stopped_at': 2}))
    with pytest.raises(BusinessError): review.save_report(tid, 'review-test', value)
    assert review.snapshot(tid)['status'] == 'stopped'

def test_basis_only_changes_for_selected_review_inputs(setup):
    tid, *_ = setup
    before = review.basis(tid)
    (artifact_store.sources_dir(tid) / '未参与文件.docx').write_bytes(b'not selected')
    assert before == review.basis(tid)
    (artifact_store.work_dir(tid) / 'analysis/structure.md').write_text('已更新招标解读')
    assert before != review.basis(tid)
