"""真实规划/检查/发布链路：空分册工作稿可继续，错误参数不会锁住重试。"""
import copy
from pathlib import Path

import pytest

from app.services import outline_contract as oc
from app.services.page_flow import directory
from app.tools.assemble_tender import assemble_tender
from app.tools.outline import outline_plan
from tests.test_assemble_tender import env


NAMES = ['商务册', '技术/资格册', '技术:资格册', '超长响应册' * 14]
PREFIX = '## 项目信息\n- 项目名称：规划重试测试\n\n'


def scaffold(name):
    return f'# 响应文件：{name}\n本册仅说明测试安排。\n\n'


def fragment(name):
    return scaffold(name) + '## 目录\n- 封面\n- 目录\n- 测试说明\n\n## 来源标注\n\n## 目录说明\n' + '\n'.join(
        f'- {title} :: 交付形态=正文编写 | 归位理由=本册既有结构 | 理由来源= | 概述=保留本册{title}说明'
        for title in ['封面', '目录', '测试说明']) + '\n'


def setup_draft(env, text):
    for name in ['requirements-format.md', 'requirements-business.md', 'evaluation.md']:
        (env['out'] / 'analysis' / name).write_text('本测试无额外招标来源条目。')
    draft = env['out'] / 'outline/tender-response-docs.md'
    draft.write_text(PREFIX + text)
    return env['task']['id'], draft


def begin_volume(name):
    return outline_plan(operation='begin', volume=name, root_titles='封面\n目录\n测试说明')


def test_empty_scaffolds_retry_without_removing_files_then_merge_and_publish(env):
    tid, draft = setup_draft(env, ''.join(map(scaffold, NAMES)))
    original = draft.read_bytes()
    for action in ['first-action', 'normal-page-retry']:
        oc.begin(tid, action)
        before = oc.path(tid).read_bytes()
        with pytest.raises(ValueError, match='root_titles须包含全部实际一级标题'):
            outline_plan(operation='begin', volume=NAMES[0], root_titles='测试说明')
        assert oc.path(tid).read_bytes() == before
        assert draft.read_bytes() == original
        # 分批提交，故意颠倒调用顺序；原草稿册序仍由程序保留。
        for name in reversed(NAMES):
            assert begin_volume(name)['ok']
        assert [v['name'] for v in oc._load(tid)['draft_plan']['volumes']] == NAMES
    for name in NAMES:
        file = Path(oc.dispatch(tid, name)['fragment_path'])
        file.parent.mkdir(parents=True, exist_ok=True)
        file.write_text(fragment(name))
        assert oc.check(tid, name, child_completed=True)['ok']
    draft.write_text(PREFIX + ''.join(Path(oc.fragment_path(tid, name)).read_text() for name in NAMES))
    assert outline_plan(operation='complete')['frozen']
    assert oc.check(tid)['ok']
    assert assemble_tender().startswith('[组装发布成功]')
    assert [d['name'] for d in directory(tid)['content']['response_documents']] == NAMES


def test_mixed_complete_and_empty_volumes_keep_existing_content_and_order(env):
    tid, draft = setup_draft(env, scaffold(NAMES[0]) + fragment(NAMES[1]) + scaffold(NAMES[2]))
    original = draft.read_bytes()
    oc.begin(tid, 'mixed-retry')
    assert begin_volume(NAMES[2])['ok']
    before = oc.path(tid).read_bytes()
    with pytest.raises(ValueError, match='原有分册及顺序'):
        outline_plan(operation='complete')
    assert oc.path(tid).read_bytes() == before
    assert begin_volume(NAMES[0])['ok']
    assert [v['name'] for v in oc._load(tid)['draft_plan']['volumes']] == NAMES[:3]
    before = oc.path(tid).read_bytes()
    with pytest.raises(ValueError, match='不能改变'):
        outline_plan(operation='begin', volume=NAMES[1], root_titles='封面\n目录\n替换原章')
    assert oc.path(tid).read_bytes() == before
    assert draft.read_bytes() == original


def test_rejected_batch_does_not_mutate_loaded_draft(env, monkeypatch):
    tid, _ = setup_draft(env, scaffold(NAMES[0]))
    oc.begin(tid, 'atomic-retry')
    begin_volume(NAMES[0])
    loaded = oc._load(tid)
    before = copy.deepcopy(loaded)
    monkeypatch.setattr(oc, '_load', lambda task_id: loaded)
    with pytest.raises(ValueError, match='来源或一级归属不合法'):
        oc.plan_batch(tid, oc.PlanBatch(volumes=[oc.VolumePatch(name=NAMES[0], bindings=[oc.Binding(source_id='missing', path=['测试说明'])])]))
    assert loaded == before
