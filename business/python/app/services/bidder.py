"""Project's confirmed bidder snapshot supplies generation facts and search scope."""
import json
from datetime import date
from pydantic import BaseModel, Field
from .. import db,company_store as cs
from .errors import BusinessError
from .edit_guard import require_idle

class BidderBody(BaseModel):
    company_id:str
    signer_id:str
    sign_date:str
    revision:int=Field(default=0,ge=0)

def row(tid):
    rows=cs.read('SELECT * FROM project_bidder WHERE task_id=?',(tid,))
    return rows[0] if rows else None

def current(tid,cid,sid,sign_date):
    company=cs.require_company(cid)
    if sid=='legal':
        if not company['profile'].get('legal_name'):raise BusinessError(422,'请先在主体档案维护法定代表人姓名')
        signer={'id':'legal','name':company['profile']['legal_name'],'title':company['profile'].get('legal_title',''),'revision':company['revision']}
    else:
        reps=cs.read('SELECT * FROM representatives WHERE id=? AND company_id=?',(sid,cid))
        if not reps:raise BusinessError(422,'签字代表必须属于当前投标主体')
        signer=reps[0]
    sources={}
    for key,kid in company['profile'].items():
        if not key.startswith('source-id:'):continue
        asset=cs.asset_state(kid)
        if asset['company_id']!=cid or str(asset['revision'])!=company['profile'].get('source-revision:'+key.removeprefix('source-id:')):
            raise BusinessError(422,'主体基础信息采用的来源资料已变化，请先在资料库重新核对取值')
        sources[key]=asset['revision']
    return {'company':company,'signer':signer,'sign_date':sign_date,'source_versions':sources}

def status(tid):
    r=row(tid)
    if not r:return {'confirmed':False,'stale':False,'revision':0,'snapshot':None}
    snapshot=json.loads(r['snapshot'])
    try:stale=current(tid,r['company_id'],r['signer_id'],r['sign_date'])!=snapshot
    except BusinessError:stale=True
    from .asset_usage import stale as assets_stale
    stale = stale or assets_stale(tid,r['revision'])
    return {**r,'snapshot':snapshot,'confirmed':True,'stale':stale}

def basis(tid):
    r=row(tid)
    if not r:return None
    try:
        actual=current(tid,r['company_id'],r['signer_id'],r['sign_date'])
    except BusinessError as error:
        actual={'invalid':error.detail}
    # Confirmation advances its CAS revision; identical identity facts do not expire unrelated chapters.
    return {'snapshot':json.loads(r['snapshot']),'current':actual}

def require_confirmed(tid):
    state=status(tid)
    if not state['confirmed']:raise BusinessError(409,'请先确认本项目投标主体、签字代表和签署日期')
    if state['stale']:raise BusinessError(409,'主体档案、代表或已采用资料已变化，请重新核对制作信息')
    return state

async def get_bidder(tid:str):
    if not db.get_task(tid):raise BusinessError(404,'项目不存在')
    return status(tid)

async def save_bidder(tid:str,body:BidderBody):
    if not db.get_task(tid):raise BusinessError(404,'项目不存在')
    require_idle(tid)
    try:date.fromisoformat(body.sign_date)
    except ValueError:raise BusinessError(422,'请填写本次签署日期')
    snapshot=current(tid,body.company_id,body.signer_id,body.sign_date)
    with cs.transaction() as c:
        old=c.execute('SELECT revision FROM project_bidder WHERE task_id=?',(tid,)).fetchone()
        cs.check_revision(old['revision'] if old else 0,body.revision)
        c.execute('INSERT INTO project_bidder VALUES(?,?,?,?,?,?) ON CONFLICT(task_id) DO UPDATE SET company_id=excluded.company_id,signer_id=excluded.signer_id,sign_date=excluded.sign_date,snapshot=excluded.snapshot,revision=excluded.revision',(tid,body.company_id,body.signer_id,body.sign_date,json.dumps(snapshot,ensure_ascii=False),body.revision+1))
    return status(tid)

def snapshot_for_task(tid):
    value=require_confirmed(tid)
    from .. import artifact_store
    path=artifact_store.work_dir(tid)/'body/投标主体信息.json'
    artifact_store._atomic_write(path,json.dumps(value['snapshot'],ensure_ascii=False,indent=2))
    return {'snapshot':value['snapshot'],'path':str(path)}
