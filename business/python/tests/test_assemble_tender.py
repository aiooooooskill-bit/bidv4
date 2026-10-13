"""assemble_tender 工具：registry 构建 / 树解析 / lineage 核对 / 发布链路（§16 任务级 out/）。"""
import json
import pytest
from app import artifact_store
from app.tools.assemble_tender import assemble_tender
from tests.util import init_env
FMT_MD = '<!-- tender-analysis | 节=format | 来源=招标文件.docx | sha256=ab | 生成=t -->\n## 一、投标文件结构要求\n本项目投标文件按技术、商务、报价三册分别编制封装。\n\n**结构大纲：**\n- 封面\n- 谈判响应声明\n\n## 二、必须有的章节（mandatory chapters）\n| 序号 | 章节名称 | 归属(bidPart) | 原文出处线索 |\n|---|---|---|---|\n| 1 | 法定代表人授权委托书 | qualification | 附件2 |\n\n## 三、招标方给出的章节示例 / 模板（templates）\n| 序号 | 模板名称 | 归属(bidPart) | 对应必须章节 | 原文出处线索 |\n|---|---|---|---|---|\n| 1 | 投标函格式 | commercial | 投标函 | 附件3 |\n\n## 待澄清登记\n| 编号 | 类型 | 问题 | 影响范围 | 建议动作 |\n|---|---|---|---|---|\n| CLAR-01 | 歧义 | 装订顺序不明 | 目录 | 向招标代理确认 |\n\n## coverage 声明\n已检查：附件2、附件3；未检查：无\n'
BIZ_MD = '<!-- tender-analysis | 节=business | 来源=招标文件.docx | sha256=ab | 生成=t -->\n## 商务技术要求清单\n| 需求（原文 verbatim 片段） | 出处（章/节/附件编号） |\n|---|---|\n| 系统须支持 500 并发用户 | 第三章 技术要求 2.1 |\n| 提供三年免费运维服务 | 第五章 服务要求 |\n\n## 待澄清登记\n| 编号 | 类型 | 问题 | 影响范围 | 建议动作 |\n|---|---|---|---|---|\n| CLAR-02 | 冲突 | 质保期两处不一致 | 商务 | 向招标代理确认 |\n\n## coverage 声明\n已检查：第三章、第五章；未检查：无\n'
EVAL_MD = '<!-- tender-analysis | 节=evaluation | 来源=招标文件.docx | sha256=ab | 生成=t -->\n## 评分标准清单\n| 评分项 | 分值 | 评分要点 | 出处 |\n|---|---|---|---|\n| 技术方案 | 30 | 完整性、可行性 | 评标办法 附表 |\n| 商务报价 | 30 | 价格分公式 | 评标办法 3.2 |\n\n## 评标办法概述\n综合评分法，价格分占 30 分。\n\n## 待澄清登记\n| 编号 | 类型 | 问题 | 影响范围 | 建议动作 |\n|---|---|---|---|---|\n| CLAR-03 | 缺失 | 附表跨页断裂 | 评分 | 核对原件 |\n\n## coverage 声明\n已检查：评标办法章；未检查：无\n'
OUTLINE_MD = '## 项目信息\n- 项目名称：测试采购项目\n- 招标编号：TEST-2026-001\n\n# 响应文件：技术部分\n本册覆盖全部技术内容，与商务/报价分册边界以须知前附表为准。\n\n## 目录\n- 技术方案（附件N）\n  - 需求理解\n  - 总体设计\n- 运维服务方案\n\n## 来源标注\n- 技术方案（附件N） :: MAND-01, REQ-01\n- 需求理解 :: REQ-01\n- 运维服务方案 :: REQ-02\n\n## 目录说明\n- 技术方案（附件N） :: 交付形态=正文编写 | 归位理由=招标规定核心技术章节 | 理由来源=MAND-01 | 概述=阐述总体技术路线与架构\n- 需求理解 :: 交付形态=正文编写 | 归位理由=覆盖业务需求理解 | 理由来源=REQ-01 | 概述=对招标需求的理解与响应\n- 运维服务方案 :: 交付形态=正文编写 | 归位理由=覆盖运维服务要求 | 理由来源=REQ-02 | 概述=运维服务与响应承诺\n'

@pytest.fixture
def env(tmp_path, monkeypatch):
    """§16：输入/产物都在当前任务 out/ 下，夹具预置 run 上下文。"""
    from app import runctx
    task, conv = init_env(tmp_path, monkeypatch)
    out = artifact_store.work_dir(task['id'])
    (out / 'analysis').mkdir(parents=True, exist_ok=True)
    (out / 'outline').mkdir(parents=True, exist_ok=True)
    (out / 'analysis' / 'requirements-format.md').write_text(FMT_MD, encoding='utf-8')
    (out / 'analysis' / 'requirements-business.md').write_text(BIZ_MD, encoding='utf-8')
    (out / 'analysis' / 'evaluation.md').write_text(EVAL_MD, encoding='utf-8')
    (out / 'outline' / 'tender-response-docs.md').write_text(OUTLINE_MD, encoding='utf-8')
    runctx.set_run(conv['id'], 'r_test', task['id'])
    yield {'task': task, 'conv': conv, 'out': out}
    runctx.clear_run()

def test_missing_inputs(tmp_path, monkeypatch):
    from app import db, runctx
    from app.config import workspace_dir
    monkeypatch.setenv('DATA_DIR', str(tmp_path / 'data'))
    db.init_db()
    task = db.create_task('测试任务')
    conv = {'id': 'dsh-test-session', 'task_id': task['id']}
    workspace_dir().mkdir(parents=True, exist_ok=True)
    runctx.set_run(conv['id'], 'r_test', task['id'])
    try:
        r = assemble_tender(**{})
    finally:
        runctx.clear_run()
    assert r.startswith('[组装失败]')
    assert '缺少上游产物' in r
    assert 'requirements-format.md' in r

def test_assemble_and_publish(env):
    r = assemble_tender(**{})
    assert r.startswith('[组装发布成功]'), r
    assert '响应文件 1 个' in r
    assert 'REQ=2' in r
    assert '悬空' not in r
    assert '已按最深承载折叠 1 处' in r
    assert '未被任何目录节点引用' in r and '最终回复' in r
    arts = artifact_store.list_from_disk()
    m = [a for a in arts if a['kind'] == 'tender.directory'][0]
    from app import db
    assert m['task_id'] == env['task']['id']
    assert m['conversation_id'] == env['conv']['id']
    idx = db.get_artifact_index(m['artifact_id'])
    assert idx['content_seq'] == 1
    assert m['source']['skill'] == 'tender-outline'
    content = json.loads(artifact_store.read_content(m['artifact_id'], m))
    doc = content['response_documents'][0]
    assert doc['name'] == '技术部分'
    assert content['meta']['项目名称'] == '测试采购项目'
    assert set(content['registry']) == {'MAND-01', 'TPL-01', 'REQ-01', 'REQ-02', 'SCORE-01', 'SCORE-02'}
    assert content['lineage_check']['dangling_ids'] == []
    top = doc['directory'][0]
    assert top['目录名称'] == '技术方案（附件N）'
    assert top['来源位置'] == ['MAND-01']
    assert top['交付形态'] == '正文编写'
    assert top['children'][0]['目录名称'] == '需求理解'
    assert top['children'][0]['来源位置'] == ['REQ-01']
    js = json.loads((env['out'] / 'outline' / 'tender-response-docs.json').read_text(encoding='utf-8'))
    assert js['lineage_check']['unused_ids'] == ['SCORE-01', 'SCORE-02', 'TPL-01']

def test_reassemble_carries_over_numbering(env):
    """编号格式透传（2026-09-10 review）：numbering 来自目录弹窗或编辑器，
    重组装必须带上——否则用户选的格式被静默清掉、下次合册回落 chapter。"""
    assert assemble_tender(**{}).startswith('[组装发布成功]')
    arts = [a for a in artifact_store.list_from_disk() if a['kind'] == 'tender.directory']
    p = artifact_store.content_path(arts[0]['artifact_id'], arts[0])
    content = json.loads(p.read_text(encoding='utf-8'))
    content['numbering'] = 'gov'
    p.write_text(json.dumps(content, ensure_ascii=False), encoding='utf-8')
    assert assemble_tender(**{}).startswith('[组装发布成功]')
    arts = [a for a in artifact_store.list_from_disk() if a['kind'] == 'tender.directory']
    fresh = json.loads(artifact_store.read_content(arts[0]['artifact_id'], arts[0]))
    assert fresh.get('numbering') == 'gov'
    content['numbering'] = 'roman-x'
    p.write_text(json.dumps(content, ensure_ascii=False), encoding='utf-8')
    assert assemble_tender(**{}).startswith('[组装失败]')  # 不静默丢弃非法设置。

def test_reassemble_identical_skips_republish(env):
    """内容未变短路（2026-09-12）：同输入二次组装 → 未重复发布（seq 不变、无恢复点、
    消息带「未重复发布」）——治「模型每轮重组装目录」把单例产物卡逐轮后推；
    上游输入真变 → 照常重发布。"""
    from app import db
    assert assemble_tender(**{}).startswith('[组装发布成功]')
    arts = [a for a in artifact_store.list_from_disk() if a['kind'] == 'tender.directory']
    aid = arts[0]['artifact_id']
    assert db.get_artifact_index(aid)['content_seq'] == 1
    assert artifact_store.latest_restore_point(aid, arts[0]) is None
    r2 = assemble_tender(**{})
    assert r2.startswith('[组装完成]'), r2
    assert '未重复发布' in r2
    assert '响应文件 1 个' in r2
    assert db.get_artifact_index(aid)['content_seq'] == 1
    assert artifact_store.latest_restore_point(aid, arts[0]) is None
    (env['out'] / 'analysis' / 'requirements-business.md').write_text(BIZ_MD.replace('提供三年免费运维服务', '提供四年免费运维服务'), encoding='utf-8')
    r3 = assemble_tender(**{})
    assert r3.startswith('[组装发布成功]'), r3
    assert db.get_artifact_index(aid)['content_seq'] == 2

def _node(name: str, ids: list[str], children: list[dict] | None=None) -> dict:
    return {'目录名称': name, 'children': children or [], '来源位置': list(ids)}

def test_fold_lineage():
    """唯一承载折叠：post-order deepest-wins 四边界 + 幂等不改入参。"""
    from app.tools.assemble_tender import _fold_lineage
    tree = [_node('A', ['MAND-01', 'REQ-01'], [_node('B', ['REQ-01'], [_node('C', ['REQ-01'])])])]
    folded, n = _fold_lineage(tree)
    assert n == 2
    a = folded[0]
    assert a['来源位置'] == ['MAND-01']
    assert a['来源'] == ['招标文件规定']
    assert a['children'][0]['来源位置'] == []
    assert a['children'][0]['children'][0]['来源位置'] == ['REQ-01']
    assert tree[0]['来源位置'] == ['MAND-01', 'REQ-01']
    again, n2 = _fold_lineage(folded)
    assert n2 == 0
    assert again[0]['来源位置'] == ['MAND-01']
    tree2 = [_node('A', ['REQ-01'], [_node('B1', ['REQ-01']), _node('B2', ['REQ-01'])])]
    folded2, n3 = _fold_lineage(tree2)
    assert n3 == 1
    assert folded2[0]['children'][0]['来源位置'] == ['REQ-01']
    assert folded2[0]['children'][1]['来源位置'] == ['REQ-01']
    tree3 = [_node('A', ['REQ-01'], [_node('B', ['REQ-02'])])]
    folded3, n4 = _fold_lineage(tree3)
    assert n4 == 0
    assert folded3[0]['来源位置'] == ['REQ-01']

def test_dangling_ids_reported_but_published(env):
    md = OUTLINE_MD.replace('- 需求理解 :: REQ-01', '- 需求理解 :: REQ-01, REQ-99')
    (env['out'] / 'outline' / 'tender-response-docs.md').write_text(md, encoding='utf-8')
    r = assemble_tender(**{})
    assert r.startswith('[组装发布成功]')
    assert '悬空来源ID' in r and 'REQ-99' in r
    arts = artifact_store.list_from_disk()
    m = [a for a in arts if a['kind'] == 'tender.directory'][0]
    content = json.loads(artifact_store.read_content(m['artifact_id'], m))
    assert content['lineage_check']['dangling_ids'] == ['REQ-99']

def test_empty_tree_warning(env):
    (env['out'] / 'outline' / 'tender-response-docs.md').write_text('# 响应文件：技术部分\n\n无目录内容。\n', encoding='utf-8')
    r = assemble_tender(**{})
    assert r.startswith('[组装发布成功]')
    assert '未解析出任何响应文件目录' in r

def test_tree_violation_and_orphan_annotation_warned(env):
    """树格式红线违反（编号行被静默跳过）与孤儿标注：警告但不拦停发布。"""
    md = OUTLINE_MD.replace('- 运维服务方案\n', '1. 实施方案\n- 运维服务方案\n').replace('- 运维服务方案 :: REQ-02\n', '- 运维服务方案 :: REQ-02\n- 售后承诺函 :: REQ-01\n')
    (env['out'] / 'outline' / 'tender-response-docs.md').write_text(md, encoding='utf-8')
    r = assemble_tender(**{})
    assert r.startswith('[组装发布成功]'), r
    assert '不符合 `- ` 列表格式的行' in r and '1. 实施方案' in r
    assert '未挂到任何目录节点' in r and '售后承诺函' in r
    js = json.loads((env['out'] / 'outline' / 'tender-response-docs.json').read_text(encoding='utf-8'))
    assert '丢节点' in js['warning'] and '售后承诺函' in js['warning']


def test_standard_markdown_survives_registry_tree_and_publication(env):
    """转义竖线不改变来源列，代码示例不生成假来源/响应文件/章节。"""
    fmt = FMT_MD.replace('法定代表人授权委托书', r'授权\|委托书').replace('投标函格式', r'投标函\|格式')
    fmt = fmt.replace(r'授权\|委托书', r'[授权\|委托书][authorization]') + '\n[authorization]: https://example.com/auth\n'
    biz = BIZ_MD.replace('系统须支持 500 并发用户', r'支持 A\|B 并发')
    biz = '~~~md\n## coverage 声明\n~~~\n\n' + biz
    evaluation = EVAL_MD.replace('技术方案 |', r'技术\|方案 |')
    outline = OUTLINE_MD.replace('- 项目名称：测试采购项目', '| 键 | 值 |\n|---|---|\n| 项目名称 | 测试\\|采购项目 |\n\n- 招标编号：TEST-2026-001')
    outline = outline.replace('  - 需求理解', '    + **需求理解**').replace('  - 总体设计', '    + 总体设计')
    outline = outline.replace('**需求理解**', '[需求理解][need]')
    outline += '\n[need]: https://example.com/need\n'
    outline += '\n~~~md\n# 响应文件：伪册\n## 目录\n- 伪章\n~~~\n'
    for name, content in (('analysis/requirements-format.md', fmt), ('analysis/requirements-business.md', biz), ('analysis/evaluation.md', evaluation), ('outline/tender-response-docs.md', outline)):
        (env['out'] / name).write_text(content)
    result = assemble_tender(**{})
    assert result.startswith('[组装发布成功]'), result
    content = json.loads((env['out'] / 'outline/tender-response-docs.json').read_text())
    assert content['registry']['MAND-01']['text'] == '授权|委托书'
    assert content['registry']['MAND-01']['出处'] == '附件2'
    assert content['registry']['TPL-01']['text'] == '投标函|格式'
    assert content['registry']['REQ-01']['text'] == '支持 A|B 并发'
    assert content['registry']['REQ-01']['出处'] == '第三章 技术要求 2.1'
    assert content['registry']['SCORE-01']['text'] == '技术|方案'
    assert content['meta']['项目名称'] == '测试|采购项目'
    assert len(content['response_documents']) == 1
    child = content['response_documents'][0]['directory'][0]['children'][0]
    assert child['目录名称'] == '需求理解' and child['来源位置'] == ['REQ-01']
