import asyncio
import pytest
from app import artifact_store, publish
from app.services import build_state, page_flow, workbench
from app.services.errors import BusinessError
from app.dispatch_enrich import build_enriched_description
from app.tools.assemble_tender import _build_req_registry, _build_mand_tpl_registry, _build_score_registry
from app.tools.validate_analysis import _check_citation_cell, _expand_citation_cell
from tests.util import init_env


@pytest.fixture
def guide_env(tmp_path, monkeypatch):
    task, _ = init_env(tmp_path, monkeypatch)
    tid = task['id']
    artifact_store.ensure_task_skeleton(tid)
    root = artifact_store.work_dir(tid)
    content = {'response_documents': [{'name': '响应文件', 'directory': [{'目录名称': '交付方案'}]}],
               'registry': {'REQ-01': {'type': '需求', 'text': '原需求', '出处': '招标正文.pdf L12-L14'}}}
    publish.publish_artifact('tender.directory/tender-response-docs@1', content, task_id=tid)
    monkeypatch.setattr(page_flow, 'directory', lambda _: {'artifact_id': 'directory', 'content_seq': 1, 'content': content})
    path = root / 'body/写作指引.md'
    path.write_text('| 节 | 模式 | 依据 | 素材 | 缺口/备注 |\n|---|---|---|---|---|\n| 交付方案 | 推理撰写 | REQ-01 | — | 无 |\n')
    return tid, path, content


def guide_file(tid):
    return next(file for file in page_flow.files(tid) if file['path'] == 'body/写作指引.md')


def test_reanalysis_and_directory_reordering_do_not_rebind_old_guide(guide_env):
    tid, path, content = guide_env
    build_state.record_guide_write(tid, None, True)
    build_state.record_preparation(tid, 'guide')
    content['registry']['REQ-01']['text'] = '重排后另一需求'
    assert build_state.snapshot(tid)['build_preparation']['guide'] == 'stale'
    assert guide_file(tid)['registry']['REQ-01']['text'] == '原需求'
    build_state.record_preparation(tid, 'guide')
    assert guide_file(tid)['registry']['REQ-01']['text'] == '原需求'
    assert path.read_text().count('REQ-01') == 1


def test_user_edit_and_model_partial_edit_keep_original_reference_meaning(guide_env):
    tid, path, content = guide_env
    build_state.record_guide_write(tid, None, True)
    build_state.record_preparation(tid, 'guide')
    content['registry']['REQ-01']['text'] = '另一招标需求'
    before = path.read_text()
    asyncio.run(workbench.write_content(workbench.WorkbenchWrite(task_id=tid, path='body/写作指引.md',
                content=before.replace('无', '用户补充说明'), base_hash=workbench._hash(before))))
    assert guide_file(tid)['registry']['REQ-01']['text'] == '原需求'
    previous_hash = page_flow.file_hash(path)
    path.write_text(path.read_text() + '\n模型局部补充文案\n')
    build_state.record_guide_write(tid, previous_hash, False)
    assert guide_file(tid)['registry']['REQ-01']['text'] == '原需求'


def test_unknown_old_guide_does_not_gain_registry_from_validation_or_partial_edit(guide_env):
    tid, path, _ = guide_env
    with pytest.raises(ValueError, match='未关联到此版本指引的可信来源'):
        build_state.record_preparation(tid, 'guide')
    assert 'registry' not in guide_file(tid)
    previous_hash = page_flow.file_hash(path)
    path.write_text(path.read_text() + '\n局部补充\n')
    build_state.record_guide_write(tid, previous_hash, False)
    with pytest.raises(ValueError, match='未关联到此版本指引的可信来源'):
        build_state.record_preparation(tid, 'guide')
    assert 'registry' not in guide_file(tid)
    before = path.read_text()
    with pytest.raises(BusinessError, match='可信来源'):
        asyncio.run(workbench.write_content(workbench.WorkbenchWrite(task_id=tid, path='body/写作指引.md',
                    content=before + '\n用户补充\n', base_hash=workbench._hash(before))))
    assert 'registry' not in guide_file(tid)
    assert build_state.snapshot(tid)['build_preparation']['guide'] != 'ready'
    with pytest.raises(BusinessError, match='可信来源'):
        build_enriched_description('写交付方案', tid)


def test_user_verified_old_snapshot_is_also_used_by_actual_dispatch(guide_env):
    tid, path, content = guide_env
    build_state.record_guide_write(tid, None, True)
    build_state.record_preparation(tid, 'guide')
    content['registry']['REQ-01']['text'] = '另一项目新增条款'
    publish.publish_artifact('tender.directory/tender-response-docs@1', content, task_id=tid)
    before = path.read_text()
    asyncio.run(workbench.write_content(workbench.WorkbenchWrite(task_id=tid, path='body/写作指引.md',
                content=before.replace('无', '原需求已核对'), base_hash=workbench._hash(before))))
    assert build_state.snapshot(tid)['build_preparation']['guide'] == 'ready'
    dispatched = build_enriched_description('写交付方案', tid)
    assert '原需求（出处：招标正文.pdf L12-L14）' in dispatched
    assert '另一项目新增条款' not in dispatched
    before = path.read_text()
    with pytest.raises(BusinessError, match='REQ-99.*可信来源'):
        asyncio.run(workbench.write_content(workbench.WorkbenchWrite(task_id=tid, path='body/写作指引.md',
                    content=before.replace('REQ-01', 'REQ-99'), base_hash=workbench._hash(before))))
    assert path.read_text() == before


def test_force_old_guide_cannot_overwrite_new_snapshot_before_rejecting(guide_env):
    tid, path, content = guide_env
    build_state.record_guide_write(tid, None, True)
    build_state.record_preparation(tid, 'guide')
    old_draft = path.read_text()
    old_hash = page_flow.file_hash(path)
    content['registry']['REQ-01']['text'] = '重新生成的要求'
    path.write_text(old_draft + '\n新模型版本\n')
    build_state.record_guide_write(tid, old_hash, True)
    build_state.record_preparation(tid, 'guide')
    new_bytes = path.read_bytes()
    new_state = build_state.read(tid)
    with pytest.raises(BusinessError, match='可信来源'):
        asyncio.run(workbench.write_content(workbench.WorkbenchWrite(task_id=tid, path='body/写作指引.md',
                    content=old_draft.replace('无', '旧草稿修改'), base_hash=old_hash, force=True)))
    assert path.read_bytes() == new_bytes
    assert build_state.read(tid) == new_state
    assert not path.with_name('写作指引.md.restorepoints').exists()
    assert guide_file(tid)['registry']['REQ-01']['text'] == '重新生成的要求'
    assert build_state.snapshot(tid)['build_preparation']['guide'] == 'ready'


def test_force_natural_basis_can_replace_conflict_without_borrowing_a_registry(guide_env):
    tid, path, content = guide_env
    build_state.record_guide_write(tid, None, True)
    old_draft = path.read_text()
    old_hash = page_flow.file_hash(path)
    content['registry']['REQ-01']['text'] = '新要求'
    path.write_text(old_draft + '\n新模型版本\n')
    build_state.record_guide_write(tid, old_hash, True)
    natural = old_draft.replace('REQ-01', '现场确认设备安装条件，按招标正文.pdf L12-L14执行。')
    asyncio.run(workbench.write_content(workbench.WorkbenchWrite(task_id=tid, path='body/写作指引.md',
                content=natural, base_hash=old_hash, force=True)))
    assert natural in path.read_text()
    assert build_state.guide_registry(tid) is None
    assert build_state.snapshot(tid)['build_preparation']['guide'] == 'ready'


def test_unknown_ref_cannot_remain_ready_with_an_old_current_stamp(guide_env):
    tid, _, _ = guide_env
    state = build_state.read(tid)
    state['guide'] = build_state.preparation_stamp(tid, 'guide')
    build_state.save(tid, state)
    snapshot = build_state.snapshot(tid)
    assert snapshot['build_preparation']['guide'] == 'stale'
    assert '指引依据引用尚未核对' in snapshot['build_preparation_changes']['guide']


def test_natural_basis_with_no_ids_is_ready_and_dispatched_without_a_snapshot(guide_env):
    tid, path, _ = guide_env
    basis = '交付时应满足设备安装条件，提供现场验收记录（招标正文.pdf L12-L14）。'
    path.write_text(path.read_text().replace('REQ-01', basis))
    build_state.record_preparation(tid, 'guide')
    assert build_state.snapshot(tid)['build_preparation']['guide'] == 'ready'
    assert build_state.guide_registry(tid) is None
    assert basis in build_enriched_description('写交付方案', tid)


def test_mixed_prose_and_short_id_preserve_full_business_basis_in_dispatch(guide_env):
    tid, path, _ = guide_env
    prose = '安装须经现场核对；对特殊场地另行说明。'
    path.write_text(path.read_text().replace('REQ-01', 'REQ-1，' + prose))
    build_state.record_guide_write(tid, None, True)
    build_state.record_preparation(tid, 'guide')
    assert build_state.snapshot(tid)['build_preparation']['guide'] == 'ready'
    dispatched = build_enriched_description('写交付方案', tid)
    assert '原需求（出处：招标正文.pdf L12-L14）' in dispatched
    assert prose in dispatched
    assert 'REQ-1' not in dispatched


def test_same_content_write_keeps_snapshot_and_new_full_write_binds_new_context(guide_env):
    tid, path, content = guide_env
    build_state.record_guide_write(tid, None, True)
    content['registry']['REQ-01']['text'] = '新生成依据'
    previous_hash = page_flow.file_hash(path)
    build_state.record_guide_write(tid, previous_hash, True)
    assert guide_file(tid)['registry']['REQ-01']['text'] == '原需求'
    path.write_text(path.read_text().replace('交付方案', '交付方案 ') + '\n新版本指引\n')
    build_state.record_guide_write(tid, previous_hash, True)
    assert guide_file(tid)['registry']['REQ-01']['text'] == '新生成依据'


def test_unrecorded_external_changes_cannot_use_trusted_registry(guide_env):
    tid, path, _ = guide_env
    build_state.record_guide_write(tid, None, True)
    path.write_text(path.read_text() + '\n外部未经记录改动\n')
    assert 'registry' not in guide_file(tid)


@pytest.mark.parametrize('source', ['采购文件.pdf', '医疗设备 招标 (新版).docx'])
def test_req_registry_expands_same_file_from_its_own_table(source):
    other = '补充要求.pdf'
    md = f'''| 需求 | 出处 |
|---|---|
| 首项 | {source} 说明（L10-L12） |
| 另一项 | 同文件 续页（L20） / 附表（L30-L32） |
| 补充项 | {other} 更正（L4）；同文件 第二项（L8） |

| 需求 | 出处 |
|---|---|
| 新表首项 | 同文件 不能继承上一表（L80） |
'''
    reg = _build_req_registry(md, [source, other])
    assert reg['REQ-02']['出处'] == f'{source} 续页（L20）；{source} 附表（L30-L32）'
    assert reg['REQ-03']['出处'] == f'{other} 更正（L4）；{other} 第二项（L8）'
    assert reg['REQ-04']['出处'] == '同文件 不能继承上一表（L80）'


def test_registry_anchors_do_not_cross_requirement_types_or_unknown_sources():
    source = '工程 招标.pdf'
    fmt = f'''## 二、必须有的章节
| 章节名称 | 原文出处线索 |
|---|---|
| 投标说明 | {source} L10 |
| 响应声明 | 同文件 L20 |

## 三、模板
| 模板名称 | 原文出处线索 |
|---|---|
| 首个模板 | 同文件 L30 |
| 另一个模板 | {source} L40 |
| 最后模板 | 同文件 L50 |
'''
    mand, tpl = _build_mand_tpl_registry(fmt, [source])
    assert mand['MAND-02']['出处'] == source + ' L20'
    assert tpl['TPL-01']['出处'] == '同文件 L30'
    assert tpl['TPL-03']['出处'] == source + ' L50'
    score = f'''| 评分项 | 分值 | 评分要点 | 出处 |
|---|---|---|---|
| 首项 | 10 | 要点 | {source} L60 |
| 次项 | 20 | 要点 | 不存在.pdf L70 |
| 末项 | 5 | 要点 | 同文件 L80 |
'''
    reg = _build_score_registry(score, [source])
    assert reg['SCORE-03']['出处'] == '同文件 L80'
    anchor = {'file': None}
    assert not _check_citation_cell(source + ' L60', [source], {source: 100}, anchor)
    assert _check_citation_cell('不存在.pdf L70', [source], {source: 100}, anchor)
    assert any('本表此前没有' in issue for issue in _check_citation_cell('同文件 L80', [source], {source: 100}, anchor))


@pytest.mark.parametrize('unknown', ['未确认 材料（更新）.pdf', '未确认材料 (新版).docx', '未确认 图示.webp'])
def test_unknown_filename_with_spaces_or_parentheses_clears_inherited_source(unknown):
    source = '主采购文件.pdf'
    cell = f'{source} L1 / {unknown} L2 / 同文件 L3'
    expanded = _expand_citation_cell(cell, [source], {'file': None})
    assert expanded == f'{source} L1；{unknown} L2；同文件 L3'
    issues = _check_citation_cell(cell, [source], {source: 100}, {'file': None})
    assert any('不在已确认来源集合' in issue for issue in issues)
    assert any('本表此前没有' in issue for issue in issues)


def test_multiple_sources_in_one_segment_do_not_share_a_line_range():
    sources = ['主采购文件.pdf', '补充 文件（修订）.pdf']
    cell = f'{sources[0]} 与 {sources[1]} L20-L22 / 同文件 L30'
    assert _expand_citation_cell(cell, sources, {'file': None}) == f'{sources[0]} 与 {sources[1]} L20-L22；同文件 L30'
    issues = _check_citation_cell(cell, sources, {source: 100 for source in sources}, {'file': None})
    assert any('多个来源文件' in issue for issue in issues)
    assert any('本表此前没有' in issue for issue in issues)


@pytest.mark.parametrize('middle', ['同文件 未确认 材料（更新）.pdf L2', '主文件.pdf L1、未确认 材料（更新）.pdf L2'])
def test_unknown_filename_anywhere_in_segment_blocks_same_file_inheritance(middle):
    source = '主文件.pdf'
    cell = f'{source} L1 / {middle} / 同文件 L3'
    expanded = _expand_citation_cell(cell, [source], {'file': None})
    assert expanded == f'{source} L1；{middle}；同文件 L3'
    issues = _check_citation_cell(cell, [source], {source: 100}, {'file': None})
    assert any('不在已确认来源集合' in issue for issue in issues)
    assert any('本表此前没有' in issue for issue in issues)


def test_each_explicit_source_with_its_own_lines_keeps_last_source_for_next_row():
    sources = ['主文件.pdf', '补充 材料（更新）.pdf']
    cell = f'{sources[0]} L12、{sources[1]} L3 / 同文件 L4'
    expected = f'{sources[0]} L12、{sources[1]} L3；{sources[1]} L4'
    anchor = {'file': None}
    assert _expand_citation_cell(cell, sources, anchor) == expected
    assert anchor['file'] == sources[1]
    assert _check_citation_cell(cell, sources, {sources[0]: 100, sources[1]: 10}, {'file': None}) == []


@pytest.mark.parametrize('source', ['采购；补充.pdf', '采购;补充.pdf', '采购，补充.pdf', '采购 (补充).pdf'])
def test_real_filename_punctuation_is_not_a_citation_separator(source):
    md = f'''| 需求 | 出处 |
|---|---|
| 首项 | {source} L12-L14 |
| 次项 | 同文件 L20 / 说明 L30 |
'''
    reg = _build_req_registry(md, [source])
    assert reg['REQ-01']['出处'] == source + ' L12-L14'
    assert reg['REQ-02']['出处'] == f'{source} L20；{source} 说明 L30'
    anchor = {'file': None}
    assert _check_citation_cell(source + ' L12-L14', [source], {source: 100}, anchor) == []
    assert _check_citation_cell('同文件 L20 / 说明 L30', [source], {source: 100}, anchor) == []


def test_ascii_semicolon_resets_citation_anchor_outside_a_real_filename():
    source = '采购;补充.pdf'
    issues = _check_citation_cell(source + ' L12; L20', [source], {source: 100}, {'file': None})
    assert any('缺文件名或' in issue for issue in issues)
