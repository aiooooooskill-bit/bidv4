"""Library queries filter domains and company before BM25 or pagination."""
import math
from .. import company_store as cs, db
from ..knowledge.search import search_assets
from .errors import BusinessError

def page_result(items,page,size,key):
    if size not in (5,10,20):raise BusinessError(422,'每页数量须为5、10或20')
    if page<1:raise BusinessError(422,'页码必须为正整数')
    total=len(items);pages=max(1,math.ceil(total/size));page=min(page,pages)
    return {key:items[(page-1)*size:page*size],'total':total,'page':page,'page_size':size,'pages':pages}

def asset_list(query,company_id):
    items=db.kb_list_items()
    if company_id!='all':
        if company_id!='unassigned':cs.require_company(company_id)
        items=[it for it in items if (it['company_id'] or '')==('' if company_id=='unassigned' else company_id)]
    if query.strip():
        matches={}
        for hit in search_assets(query,limit=100000,company_id=company_id):
            # Name priority and BM25 use different scales; retain the best channel per item.
            rank=(0,hit['rank']) if hit['section_path']=='§identity' else (1,hit['rank'])
            item_id=hit['item_id']
            if item_id not in matches or rank<matches[item_id]:matches[item_id]=rank
        items=[it for it in items if it['id'] in matches]
        items.sort(key=lambda it:matches[it['id']])
    return items
