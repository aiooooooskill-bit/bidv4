import pytest
from app import runctx
from app.services import bidder
from app.tools.check_residue import check_name_residue
from tests.engineering_env import env

@pytest.mark.parametrize('stale',[False,True])
def test_confirmed_current_company_is_not_old_but_old_company_still_detected(env,monkeypatch,stale):
 monkeypatch.setattr(bidder,'status',lambda tid:{'confirmed':True,'stale':stale,'snapshot':{'company':{'name':'杭州同花顺数据开发有限公司'},'signer':{'name':'余婉贞'}}})
 out=check_name_residue('供应商：杭州同花顺数据开发有限公司；参考旧稿：旧数据有限公司',old_names=['杭州同花顺数据开发有限公司','旧数据有限公司'])
 assert '旧数据有限公司' in out
 assert ('残留「杭州同花顺数据开发有限公司」' in out)==stale

def test_exact_current_name_does_not_mask_longer_old_name(env,monkeypatch):
 monkeypatch.setattr(bidder,'status',lambda tid:{'confirmed':True,'stale':False,'snapshot':{'company':{'name':'当前公司'},'signer':{'name':'签字代表'}}})
 out=check_name_residue('当前公司旧项目',old_names=['当前公司旧项目'])
 assert '旧名残留告警' in out

def test_unscoped_scan_does_not_protect_names(monkeypatch):
 runctx.clear_run();out=check_name_residue('当前公司',old_names=['当前公司'])
 assert '旧名残留告警' in out
