import pytest
from app.services import build_state,bidder
from app.tools.check_residue import check_name_residue
from tests.engineering_env import env


def prepare(env,monkeypatch,stale=False,unknown=False):
 monkeypatch.setattr(bidder,'status',lambda tid:{'confirmed':True,'stale':False,'snapshot':{'company':{'name':'当前供应商有限公司'},'signer':{'name':'当前代表'}}})
 p=env[1]/'body/关键事实与承诺.md';p.write_text('| 事项 | 值 | 说明 |\n|---|---|---|\n| 采购人 | '+('【待确认】' if unknown else '泉州银行股份有限公司')+' | 采购文件 |\n| 项目名称 | 本次基金数据项目 | 采购文件 |\n| 招标编号 | XYZ-2026 | 采购文件 |\n')
 monkeypatch.setattr(build_state,'read',lambda tid:{'promises':'old' if stale else 'current'})
 monkeypatch.setattr(build_state,'preparation_stamp',lambda tid,stage:'current')

@pytest.mark.parametrize('name',['泉州银行股份有限公司','泉州银行','本次基金数据项目','XYZ-2026'])
def test_current_confirmed_project_names_and_legal_shortname_are_not_old(env,monkeypatch,name):
 prepare(env,monkeypatch);out=check_name_residue(name,old_names=[name]);assert out.startswith('[残留扫描通过]'),out

@pytest.mark.parametrize('stale,unknown',[(True,False),(False,True)])
def test_stale_or_unconfirmed_procurement_name_is_not_protected(env,monkeypatch,stale,unknown):
 prepare(env,monkeypatch,stale,unknown);assert '旧名残留告警' in check_name_residue('泉州银行',old_names=['泉州银行'])

def test_exact_shortname_protection_does_not_hide_old_project_or_another_bank(env,monkeypatch):
 prepare(env,monkeypatch)
 for old in ['2025泉州银行基金项目','其他银行']:
  assert '旧名残留告警' in check_name_residue(old,old_names=[old])
