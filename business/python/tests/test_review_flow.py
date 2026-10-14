import json
from copy import deepcopy
from pathlib import Path
import shutil
import os
import pytest
from docx import Document
from docx.oxml import OxmlElement
from docx.oxml.ns import qn
from app import db, artifact_store, task_stage
from app.services import page_flow, review, review_method, review_batches
from app.tools.validate_analysis import _REQUIRED_HEADERS
from app.services.errors import BusinessError
from tests.util import init_env

def tender_citations(tid):
    return [{k: e[k] for k in ('document_id', 'start', 'end')} for e in review.review_basis(tid, True)['catalog'][0]['tender']]


@pytest.fixture
def setup(tmp_path, monkeypatch, request):
    task, _ = init_env(tmp_path, monkeypatch)
    tid = task['id']; artifact_store.ensure_task_skeleton(tid)
    for name, text in [('招标.docx', '维护服务期限为三年，须按季度提交维护记录，响应时间不超过四小时。'), ('投标.docx', '维护服务期限为一年，按季度提交维护记录，响应时间不超过四小时。')]:
        d = Document(); d.add_heading('服务要求', 1); d.add_paragraph(text * 4)
        if name == '招标.docx':
            d.add_heading('服务边界', 2); d.add_paragraph('特殊情况下，双方另行协商响应安排。')
        d.save(artifact_store.sources_dir(tid) / name)
    supplements = []
    if getattr(request, 'param', False):
        d = Document(); d.add_heading('补充说明', 1); d.add_paragraph('异地支持期限为五年，与主文件三年约定的适用范围待澄清。' * 5); d.save(artifact_store.sources_dir(tid) / '补遗.docx'); supplements.append('补遗.docx')
    page_flow.set_sources(tid, '招标.docx', supplements)
    review.set_input(tid, ['投标.docx'])
    review.prepare(tid)
    docs = review.documents(tid)
    def citation(doc):
        lines = Path(doc['path']).read_text().splitlines(); i = next(i for i, t in enumerate(lines) if '维护服务期限' in t)
        return {'document_id': doc['id'], 'start': i + 1, 'end': i + 1}
    notes = artifact_store.work_dir(tid) / 'review/analysis'; notes.mkdir(parents=True)
    for key, tables in _REQUIRED_HEADERS.items():
        text = ''
        for header in tables:
            text += '| ' + ' | '.join(header) + ' |\n| ' + ' | '.join('---' for _ in header) + ' |\n'
            if key == 'requirements-business':
                text += '| 维护服务期限为三年 | 招标.docx L' + str(citation(docs[0])['start']) + ' |\n'
            text += '\n'
        if key != 'clarifications':
            text += '## coverage 声明\n已检查：服务要求；未检查：无\n'
        if key == 'disqualification': text += '反查词表：废标、无效、否决\n'
        (notes / (key + '.md')).write_text(text)
    basis_id = review.review_basis(tid, True)['catalog'][0]['id']
    value = {'summary': '维护年限不符合招标要求。', 'requirements': [{'basis_id': basis_id, 'tender': tender_citations(tid), 'status': 'conflict', 'bid': [citation(next(d for d in docs if d['kind'] == 'bid'))]}], 'issues': [{'id': basis_id + ':issue:1', 'requirement_id': basis_id, 'risk_type': 'suggestion', 'title': '维护年限冲突', 'explanation': '投标承诺一年，要求三年。', 'suggestion': '核对实际维护年限并修订。'}], 'limitations': ['签字、盖章及证件真实性须人工确认。']}
    actions = tmp_path / 'data' / 'actions' / tid; actions.mkdir(parents=True)
    record = {'kind': 'review', 'session_id': 'review-test', 'input_version': review.basis(tid), 'created_at': 1}
    (actions / 'one.json').write_text(json.dumps(record))
    return tid, value, actions / 'one.json', record

def finish(setup):
    tid, value, path, record = setup
    batch = review_batches.next_batch(tid, 'review-test')
    p = {k: v for k, v in value['issues'][0].items() if k not in ('id', 'requirement_id')}
    proposed = review_batches.candidate(tid, 'review-test', batch['batch_id'], [{'slot': 1, 'tender': tender_citations(tid), 'status': 'conflict', 'assessment': '双方维护期限不一致。', 'bid': value['requirements'][0]['bid'], 'problems': [p]}])
    review_batches.accept(tid, 'review-test', proposed)
    review_batches.finalize(tid, 'review-test', value['summary'], value['limitations']); review.finish(tid, 'review-test')
    path.write_text(json.dumps({**record, 'finished_state': 'completed'}))
    return tid

def test_report_version_and_review_decision_survive_reload(setup):
    tid = finish(setup)
    assert review.snapshot(tid)['status'] == 'reviewed'
    review.decide(tid, 'review-test', setup[1]['issues'][0]['id'], 'fixed', '已在 Word 修改，待重审')
    assert review.snapshot(tid)['report']['decisions'][setup[1]['issues'][0]['id']]['status'] == 'fixed'
    assert task_stage.enrich([db.get_task(tid)])[0]['review_status'] == 'reviewed'
    p = artifact_store.sources_dir(tid) / '投标.docx'; d = Document(p); d.add_paragraph('版本更新'); d.save(p)
    assert review.snapshot(tid)['status'] == 'stale'
    with pytest.raises(BusinessError): review.decide(tid, 'review-test', setup[1]['issues'][0]['id'], 'confirmed', '')

def test_bid_never_becomes_tender_supplement(setup):
    tid, *_ = setup
    assert page_flow.source_selection(tid)['excluded'] == ['投标.docx']
    with pytest.raises(BusinessError, match='投标文件不能'): page_flow.set_sources(tid, '招标.docx', ['投标.docx'])
    with pytest.raises(BusinessError): review.set_input(tid, ['招标.docx'])

@pytest.mark.parametrize('invalid', ['quote', 'lines', 'role', 'requirement', 'no-bid', 'incomplete-catalog', 'no-issue'])
def test_invalid_evidence_or_incomplete_report_rejected(setup, invalid):
    tid, value, *_ = setup; value = deepcopy(value); req = value['requirements'][0]
    if invalid == 'quote': req['bid'][0]['quote'] = '这段内容原文不存在'
    if invalid == 'lines': req['bid'][0]['end'] = 999
    if invalid == 'role': req['bid'][0]['document_id'] = 'tender-0'
    if invalid == 'requirement': value['issues'][0]['requirement_id'] = 'unknown'
    if invalid == 'no-bid': req['bid'] = []
    if invalid == 'incomplete-catalog': value['requirements'][0]['basis_id'] = 'unknown-basis'
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


def test_external_unknown_does_not_force_fabricated_bid_evidence_or_issue(setup):
    tid, value, *_ = setup
    value['requirements'][0]['status'] = 'uncertain'
    value['requirements'][0]['bid'] = []
    value['issues'] = []
    value['limitations'] = ['外部真实行为与证照真实性无法由投标文字证明，须人工核验。']
    assert review.compile_report(tid, value)['requirements'][0]['status'] == 'uncertain'


def test_quotes_are_extracted_from_original_lines_and_saved_tampering_rejected(setup):
    tid, value, *_ = setup
    report = review.compile_report(tid, value)
    e = report['requirements'][0]['bid'][0]
    doc = next(d for d in review.documents(tid) if d['id'] == e['document_id'])
    assert e['quote'] == '\n'.join(Path(doc['path']).read_text().splitlines()[e['start'] - 1:e['end']])
    assert review.validate_saved_report(tid, report) == report
    e['quote'] = '模型编造的摘录'
    with pytest.raises(ValueError, match='不一致'):
        review.validate_saved_report(tid, report)


def test_report_uses_original_catalog_and_cannot_rewrite_tender(setup):
    tid, value, *_ = setup
    report = review.compile_report(tid, value)
    assert report['requirements'][0]['category'] == '商务技术要求'
    assert '维护服务期限为三年' in report['requirements'][0]['text']
    assert len(report['coverage']) == 7
    bad = deepcopy(value)
    bad['requirements'][0]['tender'] = []
    with pytest.raises(ValueError): review.compile_report(tid, bad)


def test_incomplete_original_analysis_cannot_produce_review(setup):
    tid, value, *_ = setup
    (artifact_store.work_dir(tid) / 'review/analysis/evaluation.md').unlink()
    with pytest.raises(ValueError, match='评分标准'): review.compile_report(tid, value)


def test_original_checks_are_saved_and_external_process_limits_explicit(setup):
    tid = finish(setup)
    report = review.snapshot(tid)['report']
    assert report['method']['source_commit']
    assert report['analysis']['validation'].startswith('[校验通过]')
    assert any(c['status'] == 'not_applicable' for c in report['checks'])


def test_original_docx_notes_are_marked_for_review(setup):
    tid, *_ = setup
    path = artifact_store.sources_dir(tid) / '投标.docx'
    doc = Document(path)
    level = OxmlElement('w:outlineLvl'); level.set(qn('w:val'), '1')
    doc.paragraphs[0]._p.get_or_add_pPr().append(level)
    doc.save(path)
    check = review_method.original_checks(tid, review.inputs(tid), 'external')[0]
    assert check['status'] == 'warning'
    assert '大纲级别' in check['detail']


def test_modified_review_analysis_requires_new_review(setup):
    tid = finish(setup)
    p = artifact_store.work_dir(tid) / 'review/analysis/evaluation.md'
    p.write_text(p.read_text() + '\n人工核对说明\n')
    assert review.snapshot(tid)['status'] == 'stale'


def test_platform_analysis_reuse_requires_same_source_and_current_notes(setup):
    tid, *_ = setup
    root = artifact_store.work_dir(tid)
    docs = review.documents(tid)
    tender = docs[0]
    parse = root / 'parse' / tender['name']
    shutil.copytree(Path(tender['path']).parent, parse)
    shutil.copytree(root / 'review/analysis', root / 'analysis', dirs_exist_ok=True)
    assert review_method.analysis_directory(tid, docs) == (root / 'analysis', True)
    assert review_method.analysis_context(tid, docs, 'external')['reused_platform_analysis']
    assert review_method.analysis_context(tid, docs, 'external')['sections'][0]['path'].startswith(str(root / 'analysis'))
    # Changed source bytes and changed line mapping must both invalidate reused citations.
    changed = deepcopy(docs); changed[0]['sha256'] = 'different-source'
    assert not review_method.platform_analysis_current(tid, changed)
    original = parse / (tender['name'] + '.md')
    original.write_text(original.read_text() + '\n新行\n')
    assert not review_method.platform_analysis_current(tid, docs)
    shutil.copyfile(tender['path'], original)
    os.utime(root / 'analysis/evaluation.md', (1, 1))
    assert not review_method.platform_analysis_current(tid, docs)
    (parse / (tender['name'] + '.meta.json')).write_text('{}')
    assert not review_method.platform_analysis_current(tid, docs)
    (root / 'analysis/clarifications.md').unlink()
    previous = review_method.previous_flow(tid, 'platform')
    assert len(previous['analysis_files']) == 7
    assert all(item['sha256'] for item in previous['analysis_files'])
    assert '未齐备' in previous['analysis_note']


def test_reparsed_tender_cannot_reuse_old_external_notes(setup):
    tid, value, *_ = setup
    os.utime(artifact_store.work_dir(tid) / 'review/analysis/evaluation.md', (1, 1))
    with pytest.raises(ValueError, match='旧审查要点过期'):
        review.compile_report(tid, value)


def test_platform_review_version_tracks_previous_planning(setup):
    tid, *_ = setup
    (artifact_store.work_dir(tid) / 'review/input.json').unlink()
    before = review.basis(tid)
    path = artifact_store.work_dir(tid) / 'body/关键事实与承诺.md'
    path.write_text('维护年限：三年')
    assert review.basis(tid) != before
    previous = review_method.previous_flow(tid, 'platform')
    assert previous['bidder']['snapshot'] is None
    assert previous['planning'][1]['status'] == 'missing'
    assert previous['planning'][1]['path'] == str(path)


def test_failed_comparisons_never_reused(setup):
    tid, value, *_ = setup
    folder = artifact_store.work_dir(tid) / 'review/drafts'; folder.mkdir()
    (folder / 'failed-model.json').write_text(json.dumps({'report': value}))
    assert 'drafts' not in review.review_basis(tid)
    assert review_batches.next_batch(tid, 'review-test')['accepted'] == 0


def comparison(setup):
    tid, value, *_ = setup
    batch = review_batches.next_batch(tid, 'review-test')
    problem = {k: v for k, v in value['issues'][0].items() if k not in ('id', 'requirement_id')}
    return batch, [{'slot': 1, 'tender': tender_citations(tid), 'status': 'conflict', 'assessment': '投标一年，要求三年。', 'bid': value['requirements'][0]['bid'], 'problems': [problem]}]


@pytest.mark.parametrize('bad', ['foreign-id', 'inline-line', 'inline-page', 'wrong-slot', 'tampered-quote'])
def test_batches_reject_binding_and_citation_failures(setup, bad):
    tid, *_ = setup
    batch, results = comparison(setup)
    if bad == 'foreign-id': results[0]['problems'][0]['requirement_id'] = 'other'
    if bad == 'inline-line': results[0]['problems'][0]['explanation'] = '招标L1047要求三年。'
    if bad == 'inline-page': results[0]['assessment'] = '第123行证明。'
    if bad == 'wrong-slot': results[0]['slot'] = 2
    if bad in ('foreign-id', 'inline-line', 'inline-page', 'wrong-slot'):
        with pytest.raises(ValueError): review_batches.candidate(tid, 'review-test', batch['batch_id'], results)
    else:
        proposed = review_batches.candidate(tid, 'review-test', batch['batch_id'], results)
        if bad == 'tampered-quote': proposed['comparisons'][0]['bid'][0]['quote'] = '伪造内容'
        with pytest.raises(ValueError): review_batches.accept(tid, 'review-test', proposed)
    assert review_batches.next_batch(tid, 'review-test')['accepted'] == 0


def test_batch_binding_and_completion_are_immutable(setup):
    tid = finish(setup)
    envelope = review.snapshot(tid)['report']
    req = envelope['report']['requirements'][0]
    assert envelope['report']['issues'][0]['requirement_id'] == req['id']
    assert envelope['report']['issues'][0]['id'] == req['id'] + ':issue:1'
    p = review_batches.path(tid, 'review-test'); data = json.loads(p.read_text())
    data['batches'][0]['comparisons'][0]['status'] = 'responded'; p.write_text(json.dumps(data))
    with pytest.raises(ValueError, match='绑定被修改'): review.finish(tid, 'review-test')


def test_full_report_without_complete_batches_cannot_finish(setup):
    tid, value, *_ = setup
    review.save_report(tid, 'review-test', value)
    with pytest.raises(ValueError, match='尚未完整'): review.finish(tid, 'review-test')


def test_background_fields_do_not_accept_unrelated_bid_evidence(setup, monkeypatch):
    tid, value, *_ = setup
    row = review.review_basis(tid, True)['catalog'][0] | {'category': '结构事实', 'text': '字段：代理机构；值：测试机构'}
    monkeypatch.setattr(review_batches, 'context', lambda *_: ('background-version', [[row]]))
    batch = review_batches.next_batch(tid, 'review-test')
    assert batch['requirements'][0]['response_duty'] == 'information_only'
    with pytest.raises(ValueError, match='招标背景信息无需'):
        review_batches.candidate(tid, 'review-test', batch['batch_id'], [{'slot': 1, 'tender': tender_citations(tid), 'status': 'responded', 'assessment': '投标封面写了项目名称，因此响应代理机构。', 'bid': value['requirements'][0]['bid'], 'problems': []}])
    proposed = review_batches.candidate(tid, 'review-test', batch['batch_id'], [{'slot': 1, 'tender': tender_citations(tid), 'status': 'informational', 'assessment': '仅为招标程序背景，无投标文件响应义务。', 'bid': [], 'problems': []}])
    assert proposed['comparisons'][0]['bid'] == []


def test_bid_duty_cannot_be_hidden_as_background(setup):
    tid, *_ = setup
    batch = review_batches.next_batch(tid, 'review-test')
    with pytest.raises(ValueError, match='投标义务不能'):
        review_batches.candidate(tid, 'review-test', batch['batch_id'], [{'slot': 1, 'tender': tender_citations(tid), 'status': 'informational', 'assessment': '无需核查维护年限。', 'bid': [], 'problems': []}])


def test_old_severity_cannot_be_mapped_to_business_classification(setup):
    tid, value, *_ = setup
    value = deepcopy(value)
    value['issues'][0].pop('risk_type')
    value['issues'][0]['severity'] = 'high'
    with pytest.raises(ValueError): review.compile_report(tid, value)
    batch, results = comparison(setup)
    results[0]['problems'][0].pop('risk_type')
    results[0]['problems'][0]['severity'] = 'high'
    with pytest.raises(ValueError): review_batches.candidate(tid, 'review-test', batch['batch_id'], results)


def test_same_auditor_can_correct_prior_batch_before_completion(setup, monkeypatch):
    tid, value, *_ = setup
    row = review.review_basis(tid, True)['catalog'][0]
    monkeypatch.setattr(review_batches, 'context', lambda *_: ('current-version', [[row], [row | {'id': 'other-requirement'}]]))
    batch, results = comparison(setup)
    review_batches.accept(tid, 'review-test', review_batches.candidate(tid, 'review-test', batch['batch_id'], results))
    following = review_batches.next_batch(tid, 'review-test')
    assert following['accepted'] == 1
    results[0]['assessment'] = '后文出现更完整的响应，但范围仍需确认。'
    results[0]['status'] = 'uncertain'
    results[0]['problems'][0]['risk_type'] = 'confirmation'
    review_batches.accept(tid, 'review-test', review_batches.candidate(tid, 'review-test', batch['batch_id'], results))
    assert review_batches.next_batch(tid, 'review-test') == following
    review_batches.accept(tid, 'review-test', review_batches.candidate(tid, 'review-test', following['batch_id'], results))
    rows = review_batches.completed(tid, 'review-test')
    assert len(rows) == 2
    assert rows[0]['assessment'] == results[0]['assessment']
    assert rows[0]['problems'][0]['risk_type'] == 'confirmation'
    with pytest.raises(ValueError): review_batches.candidate(tid, 'review-test', 'foreign-version:0', results)
    with pytest.raises(ValueError): review_batches.candidate(tid, 'review-test', 'current-version:2', results)


def test_completed_report_cannot_be_corrected_in_place(setup):
    tid = finish(setup)
    with pytest.raises(ValueError, match='本轮已结束'):
        review_batches.candidate(tid, 'review-test', 'old:0', [])


def test_expanded_and_separate_tender_citations_survive_full_report(setup):
    tid, value, *_ = setup
    batch, results = comparison(setup)
    doc = next(d for d in review.documents(tid) if d['kind'] == 'tender')
    lines = Path(doc['path']).read_text().splitlines()
    original = deepcopy(results[0]['tender'])
    results[0]['tender'][0]['start'] -= 1
    extra_line = next(i + 1 for i, text in enumerate(lines) if '特殊情况下' in text)
    results[0]['tender'].append({'document_id': doc['id'], 'start': extra_line, 'end': extra_line})
    results[0]['assessment'] = '维护期限不同，另有特殊情况下协商安排的约定，适用范围待澄清。'
    proposed = review_batches.candidate(tid, 'review-test', batch['batch_id'], results)
    review_batches.accept(tid, 'review-test', proposed)
    review_batches.finalize(tid, 'review-test', value['summary'], value['limitations'])
    review.finish(tid, 'review-test')
    envelope = json.loads(review._report_path(tid, 'review-test').read_text())
    req = envelope['report']['requirements'][0]
    assert len(req['tender']) == 2
    assert req['tender'][-1]['quote'] == lines[extra_line - 1]
    assert req['tender'][0]['start'] == original[0]['start'] - 1
    assert review.review_basis(tid, True)['catalog'][0]['tender'] == original
    assert review.validate_saved_report(tid, envelope['report']) == envelope['report']
    # Even a forged batch digest cannot make omitted original evidence valid.
    ledger = json.loads(review_batches.path(tid, 'review-test').read_text())
    ledger['batches'][0]['comparisons'][0]['tender'] = [req['tender'][-1]]
    ledger['batches'][0]['digest'] = page_flow.digest({k: ledger['batches'][0][k] for k in ('batch_id', 'comparisons')})
    review_batches.path(tid, 'review-test').write_text(json.dumps(ledger))
    with pytest.raises(ValueError, match='保留完整要点依据'):
        review.finish(tid, 'review-test')


@pytest.mark.parametrize('setup', [True], indirect=True)
def test_main_and_supplement_conflict_sources_are_both_preserved(setup):
    tid, value, *_ = setup
    batch, results = comparison(setup)
    doc = next(d for d in review.documents(tid) if d['name'] == '补遗.docx')
    lines = Path(doc['path']).read_text().splitlines()
    n = next(i + 1 for i, text in enumerate(lines) if '异地支持期限' in text)
    results[0]['tender'].append({'document_id': doc['id'], 'start': n, 'end': n})
    results[0]['status'] = 'uncertain'
    results[0]['problems'][0]['risk_type'] = 'confirmation'
    results[0]['assessment'] = '主文件与补遗的适用范围待澄清，两条原文并列，不决定优先级。'
    proposed = review_batches.candidate(tid, 'review-test', batch['batch_id'], results)
    review_batches.accept(tid, 'review-test', proposed)
    review_batches.finalize(tid, 'review-test', value['summary'], value['limitations'])
    review.finish(tid, 'review-test')
    report = json.loads(review._report_path(tid, 'review-test').read_text())['report']
    assert {e['document_id'] for e in report['requirements'][0]['tender']} == {'tender-0', 'tender-1'}
    assert '异地支持期限为五年' in report['requirements'][0]['tender'][1]['quote']
    assert report['requirements'][0]['status'] == 'uncertain'
    assert report['issues'][0]['risk_type'] == 'confirmation'


@pytest.mark.parametrize('failure', ['omit', 'role', 'unknown', 'range', 'quote', 'truncate', 'tamper'])
def test_tender_citation_failures_are_rejected(setup, failure):
    tid, *_ = setup
    batch, results = comparison(setup)
    e = results[0]['tender'][0]
    if failure == 'omit': results[0].pop('tender')
    if failure == 'role': e['document_id'] = 'bid-0'
    if failure == 'unknown': e['document_id'] = 'foreign-tender'
    if failure == 'range': e['end'] = 999
    if failure == 'quote': e['quote'] = '编造的原文'
    if failure == 'truncate': e['start'] = e['end'] = 1
    if failure != 'tamper':
        with pytest.raises(ValueError): review_batches.candidate(tid, 'review-test', batch['batch_id'], results)
    else:
        proposed = review_batches.candidate(tid, 'review-test', batch['batch_id'], results)
        proposed['comparisons'][0]['tender'][0]['quote'] = '编造的原文'
        with pytest.raises(ValueError, match='保存期间引用'):
            review_batches.accept(tid, 'review-test', proposed)
    assert review_batches.next_batch(tid, 'review-test')['accepted'] == 0
