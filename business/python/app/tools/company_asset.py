"""Read current reviewed values, independently from immutable machine OCR."""
import json
from .. import db,runctx,company_store as cs
from ..services.bidder import require_confirmed
from ..knowledge import store

def read_company_asset(item_id:str)->str:
    """精读本项目公司的资料：返回人工核对字段、出处、内容说明和当前核对全文；原件 OCR 是历史机器结果，当前值以本工具为准。item_id 来自 search_company_assets 的引用键 kb:<id>。"""
    ctx=runctx.current_run()
    if not ctx or not ctx.task_id:return '[资料读取失败] 当前会话没有项目'
    try:
        state=require_confirmed(ctx.task_id)
        item=db.kb_get_item(item_id)
        if not item:return '[资料读取失败] 资料不存在'
        asset=item
        if asset['company_id']!=state['company_id']:return '[资料读取失败] 资料不属于当前投标主体'
        md=store.kb_parse_paths(item['file_name'])[0]
        text=asset['corrected_text'] if asset['corrected_text'] is not None else md.read_text() if md.is_file() else ''
        from ..services.asset_usage import record_read
        record_read(ctx.task_id,ctx.conversation_id,item)
        return json.dumps({'id':item_id,'revision':item['revision'],'file_name':item['file_name'],'review_status':item['review_status'],'business':json.loads(item['business_metadata'] or '{}'),'text':text},ensure_ascii=False)
    except Exception as error:return '[资料读取失败] '+str(error)
