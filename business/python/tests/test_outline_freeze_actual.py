"""冻结须检查实际目录，拒绝后同一未冻结计划仍可正常完成。"""
import pytest
from pathlib import Path
from app.services import outline_contract as oc
from app.services.page_flow import directory
from app.tools.assemble_tender import assemble_tender
from app.tools.outline import outline_plan
from tests.test_assemble_tender import env
from tests.test_outline_contract import complete
from tests.test_outline_plan_recovery import setup_draft, fragment, PREFIX


def test_missing_actual_file_does_not_freeze(env):
    tid, file = setup_draft(env, fragment('验收册'))
    oc.begin(tid, 'actual-file-required')
    outline_plan(operation='begin')
    file.unlink()
    with pytest.raises(ValueError, match='目录文件不存在，计划未冻结'):
        outline_plan(operation='complete')
    assert oc._load(tid)['plan'] is None


def test_unregistered_actual_heading_does_not_freeze_and_can_be_fixed(env):
    tid, file = setup_draft(env, fragment('验收册'))
    oc.begin(tid, 'actual-tree-required')
    outline_plan(operation='begin')
    original = file.read_text()
    file.write_text(original.replace('- 测试说明\n', '- 测试说明\n  - 未登记子项\n'))
    with pytest.raises(ValueError, match='实际目录未通过，计划未冻结'):
        outline_plan(operation='complete')
    assert oc._load(tid)['plan'] is None
    file.write_text(original)
    assert outline_plan(operation='complete')['frozen']
    assert oc.check(tid)['ok']


@pytest.mark.parametrize('titles', [('完整性论述', '可行性论述'), ('可行性论述', '完整性论述')])
def test_frozen_scalar_bindings_can_be_registered_in_either_order_before_publish(env, titles):
    tid, plan, _ = complete(env)
    before = oc._load(tid)['plan']
    assert assemble_tender().startswith('[组装发布成功]')
    original = directory(tid)['content']
    file = env['out'] / 'outline/tender-response-docs.md'
    text = file.read_text()
    for title in titles:
        text = text.replace(f'- {title} :: SCORE-01', f'- {title} :: SCORE-01, REQ-01')
    file.write_text(text)
    oc.fragment_path(tid, plan.name).write_text(text)

    for index, title in enumerate(titles):
        result = outline_plan(operation='bind', source_id='REQ-01', volume=plan.name,
                              level1='技术方案（附件N）', level2=title)
        assert result['frozen']
        if index == 0:
            with pytest.raises(ValueError, match='来源挂接不符合已核定路径'):
                oc.check(tid)
            assert assemble_tender().startswith('[组装失败]')
            assert directory(tid)['content'] == original
    assert oc.check(tid)['ok']
    assert assemble_tender().startswith('[组装发布成功]')
    after = oc._load(tid)['plan']
    assert before['decisions'] == after['decisions']
    assert before['exclusions'] == after['exclusions']
    assert before['volumes'][0]['headings'] == after['volumes'][0]['headings']
    assert all(b in after['volumes'][0]['bindings'] for b in before['volumes'][0]['bindings'])
    assert oc._load(tid)['binding_additions_audit'] == [
        {'volume': plan.name, 'source_id': 'REQ-01', 'path': ['技术方案（附件N）', title]}
        for title in titles]


def test_multivolume_missing_heading_is_applied_before_first_freeze_then_published(env):
    names = ['商务册', '技术册']
    tid, merged = setup_draft(env, ''.join(fragment(name) for name in names))
    (env['out'] / 'analysis/requirements-business.md').write_text(
        '## 商务技术要求清单\n| 需求 | 出处 |\n|---|---|\n'
        '| 本项目须提交实施计划 | 第三章 技术要求 |\n')
    oc.begin(tid, 'apply-before-freeze')
    assert outline_plan(operation='begin')['ok']
    for name in names:
        oc.dispatch(tid, name)
        assert oc.check(tid, name, child_completed=True)['ok']
    unaffected = oc.fragment_path(tid, names[0]).read_bytes()
    assert outline_plan(operation='decide', unit_id='REQ-01:1', kind='heading',
                        reason='本项目明确要求提交实施计划，需在技术册设独立标题承载',
                        volume=names[1], level1='测试说明', level2='实施计划')['ok']
    with pytest.raises(ValueError, match='缺少实际标题路径'):
        outline_plan(operation='complete')
    assert oc._load(tid)['plan'] is None
    assert assemble_tender().startswith('[组装失败]')
    assignment = oc.dispatch(tid, names[1])
    assert assignment['phase'] == 'structure_locked'
    assert assignment['volume']['headings'][0]['path'] == ['测试说明', '实施计划']
    file = Path(assignment['fragment_path'])
    file.write_text(file.read_text().replace('- 测试说明\n', '- 测试说明\n  - 实施计划\n')
                    .replace('## 来源标注\n', '## 来源标注\n- 实施计划 :: REQ-01\n'))
    assert oc.check(tid, names[1], child_completed=True)['ok']
    assert outline_plan(operation='complete')['frozen']
    merged.write_text(PREFIX + '\n\n'.join(oc.fragment_path(tid, name).read_text() for name in names))
    assert oc.check(tid)['ok']
    assert assemble_tender().startswith('[组装发布成功]')
    docs = directory(tid)['content']['response_documents']
    assert [doc['name'] for doc in docs] == names
    assert docs[1]['directory'][2]['children'][0]['目录名称'] == '实施计划'
    assert oc.fragment_path(tid, names[0]).read_bytes() == unaffected
