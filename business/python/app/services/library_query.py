"""Library queries filter domains and company before BM25 or pagination."""
import math
from .. import company_store as cs, db
from ..knowledge.fts import build_match_expr
from .errors import BusinessError

def page_result(items,page,size,key):
    if size not in (5,10,20):raise BusinessError(422,'每页数量须为5、10或20')
    if page<1:raise BusinessError(422,'页码必须为正整数')
    total=len(items);pages=max(1,math.ceil(total/size));page=min(page,pages)
    return {key:items[(page-1)*size:page*size],'total':total,'page':page,'page_size':size,'pages':pages}

def asset_list(query,company_id):
    from .knowledge import _item_out
    items=[_item_out(it) for it in db.kb_list_items()]
    if company_id!='all':
        if company_id!='unassigned':cs.require_company(company_id)
        items=[it for it in items if (it['company_id'] or '')==('' if company_id=='unassigned' else company_id)]
    expr=build_match_expr(query) if query.strip() else None
    if query.strip():
        matches={}
        for hit in db.kb_search_segments(expr,limit=100000,domain='kb',company_id=company_id) if expr else []:
            matches.setdefault(hit['item_id'],hit['rank'])
        q=query.strip().lower()
        items=[it for it in items if it['id'] in matches or q in (it['file_name']+' '+it['title']).lower()]
        items.sort(key=lambda it:matches.get(it['id'],0))
    return items
