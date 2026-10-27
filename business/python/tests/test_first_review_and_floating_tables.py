from copy import deepcopy
from pathlib import Path
from docx import Document
from docx.oxml import OxmlElement
from docx.oxml.ns import qn
from app.services.document_format import fit_table
from app.services import financial_assertions as financial
import json
import subprocess
import sys
import pytest
from tests.test_review_flow import setup, comparison, fixture_candidate
from app.services import review_batches, review


def test_imported_floating_table_flows_without_losing_rows_or_source():
    doc = Document()
    table = doc.add_table(rows=8, cols=2)
    for i, row in enumerate(table.rows):
        row.cells[0].text = str(i)
        row.cells[1].text = f'合同案例{i}'
    table._tbl.tblPr.append(OxmlElement('w:tblpPr'))
    source = deepcopy(table._tbl)
    expected = [t.text for t in table._tbl.iter(qn('w:t'))]
    fit_table(table._tbl, 8000)
    assert table._tbl.find('./' + qn('w:tblPr') + '/' + qn('w:tblpPr')) is None
    assert len(table.rows) == 8
    assert [t.text for t in table._tbl.iter(qn('w:t'))] == expected
    assert source.find('./' + qn('w:tblPr') + '/' + qn('w:tblpPr')) is not None


def test_first_pass_candidates_include_inferences_not_just_completed_claims(tmp_path, monkeypatch):
    p = tmp_path / 'bid.md'
    p.write_text('按40%、50%、10%付款。\n服务成本在全年均匀发生。\n首次付款即可回收前期投入。\n报价已充分考虑范围调整。\n报价表尚未提供，不能据此确认成本已覆盖。\n')
    monkeypatch.setattr(financial.review, 'documents', lambda tid: [{'id':'bid', 'kind':'bid', 'path':str(p)}])
    claims = financial.candidates('test')
    assert [c['evidence']['start'] for c in claims] == [2, 3, 4, 5]
    assert all(c['evidence']['start'] == c['evidence']['end'] for c in claims)
    assert not financial.not_asserted(claims[0]['text'])
    assert financial.not_asserted(claims[-1]['text'])
    assert not financial.not_asserted('报价尚未确认；服务成本全年均匀发生。')
    assert financial.CLAIM.search('我方按范围将上表案例与本次包3报价作横向比对。')
    assert financial.CLAIM.search('上表所列合同价格为各建设单位确定的合同价。')
    assert financial.not_asserted('拟采用价格比较方法，尚未开展横向比对。')


def test_financial_owner_is_cost_requirement_without_adding_fake_tender_rules():
    groups = [[{'id':'background', 'category':'结构事实', 'text':'预算28万元'},
               {'id':'payment', 'category':'商务技术要求', 'text':'付款比例'},
               {'id':'cost', 'category':'废标条款', 'text':'低价成本说明'}]]
    assert financial.owner(groups) == 'cost'


@pytest.mark.parametrize('bad', ['omitted', 'self-proof', 'payment-proof', 'not-asserted', 'no-confirmation'])
def test_first_review_cannot_silently_skip_or_self_certify_cost_claims(setup, monkeypatch, bad):
    tid, *_ = setup
    batch, results = comparison(setup)
    ref = results[0]['bid'][0]
    claim = {'id':'cost-test', 'evidence':ref, 'text':'服务成本全年均匀发生，首次付款即可回收投入。'}
    monkeypatch.setattr(financial, 'candidates', lambda _: [claim])
    check = {'id':'cost-test', 'status':'uncertain', 'reason':'缺少实际成本输入，不能由付款比例推导成本回收。', 'basis':[]}
    if bad == 'self-proof': check.update(status='supported', basis=[{'evidence':ref, 'text':review_batches.quote(tid, ref)['quote']}])
    if bad == 'payment-proof':
        tender = results[0]['tender'][0]
        check.update(status='supported', basis=[{'evidence':tender, 'text':review_batches.quote(tid, tender)['quote']}])
    if bad == 'not-asserted': check['status']='not_asserted'
    results[0]['assertion_checks'] = [] if bad == 'omitted' else [check]
    with pytest.raises(ValueError):
        fixture_candidate(tid, 'review-test', batch['batch_id'], results)
    assert review_batches.next_batch(tid, 'review-test')['accepted'] == 0


def test_first_review_preserves_cost_gap_in_canonical_audit(setup, monkeypatch):
    tid, *_ = setup
    batch, results = comparison(setup)
    ref = results[0]['bid'][0]
    claim = {'id':'cost-test', 'evidence':ref, 'text':review_batches.quote(tid, ref)['quote']}
    monkeypatch.setattr(financial, 'candidates', lambda _: [claim])
    results[0]['assertion_checks']=[{'id':'cost-test','status':'uncertain','reason':'没有成本计算输入。','basis':[]}]
    results[0]['problems'][0]['risk_type']='confirmation'
    proposed=fixture_candidate(tid, 'review-test', batch['batch_id'], results)
    review_batches.accept(tid, 'review-test', proposed)
    rows=review_batches.completed(tid, 'review-test')
    audit=review_batches.audit_view(rows, 1)
    assert next(iter(audit['evidence_notes'].values()))['assertion_checks'][0]['status']=='uncertain'
    assert rows[0]['financial_assertions']==[claim]


def test_runner_rejects_string_array_and_unknown_arguments_before_execution(tmp_path):
    runner=Path(__file__).parents[1]/'runner.py'
    for params, field in [({'section':'body','block_ids':'["blk_123"]'},'block_ids'),({'section':'body','invented':True},'invented')]:
        request={'operation':'tool','args':{'name':'validate_body','parameters':params},'data_root':str(tmp_path),'task_id':'test'}
        result=subprocess.run([sys.executable,str(runner)],input=json.dumps(request),text=True,capture_output=True)
        assert result.returncode==1
        error=json.loads(result.stdout)
        assert error['status']==422 and field in error['error']
        assert not (tmp_path/'workspace/test/work/body').exists()


def test_long_catalog_reference_is_supplied_as_valid_cards_without_dropping_lines(monkeypatch):
    monkeypatch.setattr(review_batches, 'quote', lambda tid, e: e | {'quote': f'{e["start"]}-{e["end"]}'})
    cards=review_batches.tender_cards('test',[{'document_id':'tender','start':38,'end':175}])
    assert [(c['start'],c['end']) for c in cards]==[(38,138),(139,175)]
    assert [n for c in cards for n in range(c['start'],c['end']+1)]==list(range(38,176))
    assert all(c['end']-c['start']<=100 for c in cards)
