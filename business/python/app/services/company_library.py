"""Formal library management, separate from generation-time company scope."""
import json
from pydantic import BaseModel, ConfigDict, Field
from .. import company_store as cs, db
from ..knowledge.types import TYPES
from .errors import BusinessError

class CompanyBody(BaseModel):
    id: str | None=None
    revision: int=Field(default=0,ge=0)
    name: str=Field(min_length=1,max_length=200)
    credit_code: str=Field(default='',max_length=100)
    note: str=Field(default='',max_length=4000)
    profile: dict[str,str]=Field(default_factory=dict)

class RepresentativeBody(BaseModel):
    model_config = ConfigDict(extra='forbid')
    id: str | None=None
    revision: int=Field(default=0,ge=0)
    name: str=Field(min_length=1,max_length=100)
    title: str=Field(default='',max_length=100)
    phone: str=Field(default='',max_length=100)
    email: str=Field(default='',max_length=200)
    note: str=Field(default='',max_length=4000)

class ReviewBody(BaseModel):
    revision: int=Field(ge=0)
    company_id: str
    title: str=Field(min_length=1,max_length=200)
    business: dict
    text: str | None=None

async def overview():
    return {'companies':cs.companies(),'representatives':cs.read('SELECT * FROM representatives ORDER BY name,id')}

async def save_company(body: CompanyBody):
    if body.id and not cs.company(body.id):raise BusinessError(404,'投标主体不存在，请重新读取资料库')
    name=body.name.strip()
    if not name:raise BusinessError(422,'请填写主体名称')
    values={'name':name,'credit_code':body.credit_code.strip(),'note':body.note,'profile':json.dumps(body.profile,ensure_ascii=False)}
    if not body.id:values['created_at']=db._now()
    cid=cs.save_entity('companies',body.id or cs.new_id('co'),values,body.revision)
    return cs.require_company(cid)

async def save_representative(body: RepresentativeBody):
    if body.id and not cs.read('SELECT id FROM representatives WHERE id=?',(body.id,)):raise BusinessError(404,'授权代表不存在，请重新读取资料库')
    if not body.name.strip():raise BusinessError(422,'请填写代表姓名')
    values=body.model_dump(exclude={'id','revision'})
    values['name']=body.name.strip()
    rid=cs.save_entity('representatives',body.id or cs.new_id('rep'),values,body.revision)
    return cs.read('SELECT * FROM representatives WHERE id=?',(rid,))[0]

async def review_asset(kid: str, body: ReviewBody):
    if not body.title.strip():raise BusinessError(422,'请填写资料名称')
    metadata=body.business
    if metadata.get('doc_type') not in TYPES:raise BusinessError(422,'请选择资料类型')
    for group in ('fields','extra'):
        if not isinstance(metadata.get(group,{}),dict):raise BusinessError(422,'整理字段格式不正确')
        for key,value in metadata.get(group,{}).items():
            if not key.strip() or not isinstance(value,dict) or not isinstance(value.get('value'),str) or not isinstance(value.get('source',''),str):
                raise BusinessError(422,'每个字段需要名称、文本值和出处')
    if not isinstance(metadata.get('statement',''),str) or not isinstance(metadata.get('questions',[]),list) or any(not isinstance(q,str) for q in metadata.get('questions',[])):
        raise BusinessError(422,'内容说明或检索问题格式不正确')
    cs.save_asset(kid,body.revision,body.company_id,body.title.strip(),metadata,body.text)
    from .knowledge import get_item
    return await get_item(kid)

async def candidates(cid: str):
    cs.require_company(cid)
    rows=cs.read("SELECT k.id,k.title,k.file_name,k.business_metadata,a.revision FROM kb_items k JOIN company_assets a ON a.item_id=k.id WHERE a.company_id=? AND k.review_status='confirmed'",(cid,))
    return {'items':[{'id':r['id'],'title':r['title'],'file_name':r['file_name'],'revision':r['revision'],'metadata':json.loads(r['business_metadata'] or '{}')} for r in rows]}
