import json
import pytest
from app import artifact_store, config
from app.dispatch_enrich import build_enriched_description
from tests.test_dispatch_enrich import env, _seed


def phase(tid,kind):
 p=config.data_dir()/'actions'/tid/'latest.json';p.parent.mkdir(parents=True,exist_ok=True);p.write_text(json.dumps({'kind':kind,'state':'running'}))


@pytest.mark.parametrize('desc',['写 3.1 项目理解','写 3.1 项目理解、3.2 总体设计','写 3.1 项目理解\n'+'保留原稿。'*100])
def test_revision_dispatch_contains_only_revision_methodology(env,desc):
 tid=_seed(env);phase(tid,'revise');out=build_enriched_description(desc,tid)
 assert '当前阶段：局部修订' in out
 assert '先docx_section_read读取现稿' in out and '未被点名' in out
 assert '直接从建节开工' not in out and '建节→注入' not in out
 assert 'docx_section_create' not in out and 'docx_material_inject' not in out


def test_generation_still_receives_original_generation_methodology(env):
 tid=_seed(env);phase(tid,'body');out=build_enriched_description('写 3.1 项目理解',tid)
 assert '直接从建节开工' in out and 'docx_section_create' in out


def test_actual_parse_file_paths_are_provided_without_outline_title_match(env):
 tid=_seed(env);phase(tid,'revise');p=artifact_store.work_dir(tid)/'parse/采购稿.final.docx/采购稿.final.docx.md';p.parent.mkdir(parents=True);p.write_text('采购原文')
 out=build_enriched_description('写 3.1 项目理解',tid)
 assert str(p.resolve()) in out and '不要从来源名推测解析文件名' in out
 assert not (p.parent/'采购稿.final.md').exists()


def test_title_only_revision_dispatch_keeps_original_user_constraints(env):
 tid=_seed(env);p=config.data_dir()/'actions'/tid/'latest.json';p.parent.mkdir(parents=True,exist_ok=True)
 instruction='仅把指定字词改正，其他正文、表格、图片与批注全部保留；本轮业务问题只记录。'
 p.write_text(json.dumps({'kind':'revise','instruction':instruction,'section_paths':['body/3.1 项目理解与需求分析.docx']}))
 out=build_enriched_description('写 3.1 项目理解',tid)
 assert instruction in out and out.count(instruction)==1
 assert '仅在当前已分配章节内执行' in out


def test_revision_context_treats_figures_materials_and_gaps_as_reference_only(env):
 tid=_seed(env);phase(tid,'revise')
 guide=artifact_store.work_dir(tid)/'body/写作指引.md'
 guide.write_text(guide.read_text().replace('| 素材 | 缺口/备注 |','| 素材 | 图示 | 缺口/备注 |').replace('|---|---|---|---|---|','|---|---|---|---|---|---|').replace('| — | 无 |','| — | 分层:架构 | 【缺】签字信息 |').replace('| blk_abc123def456 | 无 |','| blk_abc123def456 | — | 无 |'))
 build_state=__import__('app.services.build_state',fromlist=['record_guide_write'])
 build_state.record_guide_write(tid,None,True)
 out=build_enriched_description('写 3.1 项目理解',tid)
 assert '既有图示规划（仅供核对与汇报' in out
 assert '公司材料与既有缺口（仅供核对及汇报' in out
 assert '逐项产出' not in out and '加批注待办' not in out


@pytest.mark.parametrize('readonly',[False,True])
def test_readonly_and_revision_missing_promises_never_authorize_comments(env,readonly):
 tid=_seed(env);phase(tid,'revise')
 action=config.data_dir()/'actions'/tid/'latest.json';action.write_text(json.dumps({'kind':'revise','read_only':readonly}))
 (artifact_store.work_dir(tid)/'body/关键事实与承诺.md').write_text('')
 out=build_enriched_description('写 3.1 项目理解',tid)
 assert 'docx_comment_add' not in out and '缺项一律用' not in out
 if readonly:
  assert '当前阶段：只读' in out
  assert '当前阶段：局部修订' not in out and '按指定范围定向修订' not in out
  assert '删除未确认承诺时' not in out and '建节→注入' not in out
 else:assert '当前阶段：局部修订' in out
