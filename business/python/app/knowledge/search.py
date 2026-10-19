"""Shared company-scoped content search and raw-file location."""
from .. import db
from . import fts
from .availability import identity

def search_assets(query, *, company_id='all', doc_type=None, limit=32):
    """Return up to limit content hits and limit independently ranked name hits."""
    query = query.strip()
    if not query:
        return []
    expr = fts.build_match_expr(query)
    hits = db.kb_search_segments(expr, limit=limit, domain='kb', company_id=company_id, doc_type=doc_type, exclude_identity=True) if expr else []
    words = fts.query_words(query)
    name_query = query.casefold()
    locators = []
    # Name location is independent of FTS, including symbol-only filenames.
    for item in db.kb_list_items():
        if company_id != 'all' and (item['company_id'] or '') != ('' if company_id == 'unassigned' else company_id):
            continue
        if doc_type and item.get('doc_type') != doc_type:
            continue
        name = identity(item).casefold()
        if name_query in name or any(w.casefold() in name for w in words):
            rank = -2 if name_query in (item['title'].casefold(), item['file_name'].casefold()) else -1 if name_query in name else 0
            locators.append({'item_id': item['id'], 'section_path': '§identity', 'line_start': None,
                             'line_end': None, 'page_start': None, 'rank': rank})
    locators.sort(key=lambda hit:hit['rank'])
    return hits + locators[:limit]
