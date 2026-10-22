"""Context reduction must preserve source evidence and existing quality gates."""
import json
import pytest
from app import db, artifact_store
from app.tools.read import read_artifact
from app.tools.outline import outline_plan
from app.tools.assemble_tender import assemble_tender
from app.services import outline_contract as oc
from tests.test_assemble_tender import env
from tests.test_outline_contract import aligned_structure
from tests.test_review_flow import setup as review_setup, fixture_candidate

CONTRACT = 'tender.directory/tender-response-docs@1'


def test_directory_views_keep_full_evidence_and_ancestor_constraints(env):
    assert assemble_tender().startswith('[组装发布成功]')
    index = json.loads(read_artifact(CONTRACT))
    assert index['view'] == 'index' and 'registry' not in index
    assert index['response_documents'][0]['sections'][1]['path'] == ['技术方案（附件N）', '需求理解']
    part = json.loads(read_artifact(CONTRACT, view='section', volume='技术部分',
        section_path=['技术方案（附件N）', '需求理解'], content_seq=index['content_seq']))
    full = json.loads(read_artifact(CONTRACT, view='full'))
    assert part['node'] == full['response_documents'][0]['directory'][0]['children'][0]
    assert part['ancestors'][0]['目录名称'] == '技术方案（附件N）'
    assert part['registry'] == {k: full['registry'][k] for k in ('MAND-01', 'REQ-01')}
    source = json.loads(read_artifact(CONTRACT, view='sources', source_ids=['SCORE-01']))
    assert source['registry']['SCORE-01'] == full['registry']['SCORE-01']
    assert source['registry']['SCORE-01']['评分要点'] == '完整性、可行性'
    assert len(read_artifact(CONTRACT)) < len(read_artifact(CONTRACT, view='full'))


def test_views_reject_stale_versions_unknown_paths_and_cross_task(env):
    assert assemble_tender().startswith('[组装发布成功]')
    index = json.loads(read_artifact(CONTRACT))
    assert '版本已变化' in read_artifact(CONTRACT, content_seq=index['content_seq'] + 1)
    assert '路径不存在' in read_artifact(CONTRACT, view='section', volume='技术部分', section_path=['不存在'])
    assert '不存在的来源' in read_artifact(CONTRACT, view='sources', source_ids=['REQ-999'])
    assert '不填volume' in read_artifact(CONTRACT, view='sources', source_ids=['REQ-01'], volume='技术部分')
    assert '范围参数' in read_artifact(CONTRACT, view='full', section_path=['技术方案（附件N）'])
    row = db.get_artifact_index(index['artifact_id'])
    row['content_seq'] += 1
    db.upsert_artifact_index(row)
    assert '版本已变化' in read_artifact(CONTRACT, view='section', volume='技术部分',
        section_path=['技术方案（附件N）'], content_seq=index['content_seq'])
    assert json.loads(read_artifact(CONTRACT))['content_seq'] == row['content_seq']
    from app import runctx
    task = db.create_task('其它项目')
    runctx.set_run('other', 'read', task['id'])
    assert '不在当前任务' in read_artifact(CONTRACT, artifact_id=index['artifact_id'])


def test_batch_exclusion_is_atomic_and_preserves_per_source_reasons(env):
    tid = env['task']['id']
    oc.begin(tid, 'small-exclusions')
    aligned_structure(env)
    before = oc.path(tid).read_bytes()
    with pytest.raises(ValueError, match='registry'):
        outline_plan(operation='exclude', exclusions=[{'source_id':k,'reason':'这些内容在本响应文件范围之外'} for k in ['REQ-02', 'REQ-999']])
    assert oc.path(tid).read_bytes() == before
    for ids in [[], ['REQ-02', 'REQ-02'], ['REQ-02'] * 9]:
        with pytest.raises(ValueError):
            outline_plan(operation='exclude', exclusions=[{'source_id':k,'reason':'这些内容在本响应文件范围之外'} for k in ids])
        assert oc.path(tid).read_bytes() == before
    items = [{'source_id':'REQ-02','reason':'运维事项不在本响应文件范围内，另行归位'},
             {'source_id':'SCORE-02','reason':'报价评分属于另外响应文件，不在本册重复'}]
    result = outline_plan(operation='exclude', exclusions=items)
    assert result['accepted_source_ids'] == ['REQ-02', 'SCORE-02']
    assert 'pending_sources' not in result and len(result['next_source_ids']) <= 8
    assert oc._load(tid)['draft_plan']['exclusions'] == items
    with pytest.raises(ValueError):
        outline_plan(operation='complete')


def test_batch_does_not_bypass_scoring_alignment(env):
    tid = env['task']['id']
    oc.begin(tid, 'unreviewed-score')
    outline_plan(operation='begin')
    outline_plan(operation='exclude', exclusions=[{'source_id':k,'reason':'该评分项声明在其它响应文件核对'} for k in ['SCORE-01', 'SCORE-02']])
    with pytest.raises(ValueError, match='评分对齐'):
        outline_plan(operation='complete')


def test_review_receipt_continues_all_batches_and_still_allows_correction(review_setup):
    from app.services import review, review_batches as rb
    tid, value, _, _ = review_setup
    notes = artifact_store.work_dir(tid) / 'review/analysis/requirements-business.md'
    text = notes.read_text()
    line = next(s for s in text.splitlines(keepends=True) if s.startswith('| 维护服务期限为三年 |'))
    notes.write_text(text.replace(line, line * 9))
    assert len(review.review_basis(tid, True)['catalog']) == 9
    first = rb.next_batch(tid, 'review-test')
    saved = []
    batch = first
    while not batch.get('complete'):
        rows = [dict(slot=r['slot'], tender=[{k:e[k] for k in ('document_id','start','end')} for e in r['tender']],
            bid=value['requirements'][0]['bid'], status='uncertain', assessment='双方期限文字不同，适用范围待核对。',
            problems=[dict(risk_type='confirmation', title='适用范围待核对', explanation='核对双方适用范围。', suggestion='确认实际范围。')]) for r in batch['requirements']]
        proposed = fixture_candidate(tid, 'review-test', batch['batch_id'], rows)
        receipt = rb.accept(tid, 'review-test', proposed)
        saved.append(proposed)
        if not receipt['next'].get('complete'):
            assert '不再无参调用' in receipt['next_action']
        batch = receipt['next']
    assert batch['accepted'] == 9 and len(saved) == 2
    assert len(rb.completed(tid, 'review-test')) == 9
    original = rb.next_batch(tid, 'review-test', saved[0]['batch_id'])
    assert len(original['saved_results']) == 8
    updated = fixture_candidate(tid, 'review-test', saved[0]['batch_id'], original['saved_results'])
    rb.accept(tid, 'review-test', updated)
    assert len(rb.completed(tid, 'review-test')) == 9
    with pytest.raises(ValueError, match='不能重复或遗漏'):
        fixture_candidate(tid, 'review-test', saved[0]['batch_id'], original['saved_results'][:-1])
