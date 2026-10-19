import json
from .. import db
from . import store,fts
from .segmenter import segments_from
from .extract import validate_suggested
from .types import FIELD_LABELS
from .availability import identity

def _loads(raw) -> dict | None:
    if not raw:
        return None
    try:
        data = json.loads(raw)
        return data if isinstance(data, dict) else None
    except ValueError:
        return None

def statement_segment(statement: str) -> dict | None:
    """内容说明 → 检索段（§statement；语义密度最高的可检索单元）。"""
    text = (statement or "").strip()
    if len(text) < 20:
        return None
    return {
        "section_path": "§statement",
        "line_start": None, "line_end": None, "page_start": None,
        "raw": text,
    }

def questions_segment(questions) -> dict | None:
    """检索问题 → 检索段（§questions；「用户会怎么问」的字面检索入口）。"""
    qs = [q.strip() for q in (questions or []) if isinstance(q, str) and q.strip()]
    if not qs:
        return None
    return {
        "section_path": "§questions",
        "line_start": None, "line_end": None, "page_start": None,
        "raw": "\n".join(qs),
    }

def reindex_item(kid: str) -> None:
    """重建条目检索段（唯一重建入口）：outline 段 + 内容说明段（§statement）+
    检索问题段（§questions）+ 当前整理元数据合成段 + 原件定位段（非事实）。写作素材在独立素材库
    （materials_lib），知识库无章节块。"""
    from ..company_store import transaction
    with transaction() as conn:
        row=conn.execute('SELECT k.*,COALESCE(a.revision,0) AS review_revision,a.corrected_text FROM kb_items k LEFT JOIN company_assets a ON a.item_id=k.id WHERE k.id=?',(kid,)).fetchone()
        item=dict(row) if row else None
    if not item:
        return
    segs: list[dict] = []
    md_path, outline_path, _, _ = store.kb_parse_paths(item["file_name"])
    correction = item.get('corrected_text')
    if correction is not None or md_path.is_file():
        md_text = correction if correction is not None else md_path.read_text(encoding="utf-8")
        from ..parse import outline_with_lines
        outline = outline_with_lines(md_text) if correction is not None else json.loads(outline_path.read_text(encoding="utf-8")) if outline_path.is_file() else []
        segs = segments_from(md_text, outline)
        if correction is not None and outline and outline[0]['start_line']>1:
            prefix='\n'.join(md_text.splitlines()[:outline[0]['start_line']-1])
            segs = segments_from(prefix, []) + segs

    # 内容说明段 + 检索问题段（business 版优先）
    basis = _loads(item.get("business_metadata")) or _loads(item.get("suggested_metadata"))
    if basis:
        st = statement_segment(basis.get("statement"))
        if st:
            segs.append(st)
        qs = questions_segment(basis.get("questions"))
        if qs:
            segs.append(qs)

    # 当前整理字段段（与页面条目信息一致）
    biz = _loads(item.get("business_metadata"))
    if biz:
        pairs = []
        for k, v in (biz.get("fields") or {}).items():
            pairs.append(f"{FIELD_LABELS.get(k, k)}：{v.get('value') if isinstance(v, dict) else v}")
        for k, v in (biz.get("extra") or {}).items():
            pairs.append(f"{FIELD_LABELS.get(k, k)}：{v.get('value') if isinstance(v, dict) else v}")
        if pairs:
            segs.append({
                "section_path": "条目信息（当前核对值）",
                "line_start": None, "line_end": None, "page_start": None,
                "raw": "\n".join(pairs),
            })
    # Locator only: search tools must never present this as company evidence.
    segs.append({'section_path': '§identity', 'line_start': None, 'line_end': None,
                 'page_start': None, 'raw': identity(item)})
    db.kb_replace_segments(
        kid,
        [{**s, "body": fts.segment_for_fts(s.pop("raw"))} for s in segs], expected_revision=item['review_revision'],
    )

def finish(kid,metadata):
    item=db.kb_get_item(kid)
    suggested=validate_suggested(metadata,item['file_name'])
    db.kb_update_item(kid,preserve_confirmed=True,doc_type=suggested['doc_type'],suggested_metadata=json.dumps(suggested,ensure_ascii=False),business_metadata=json.dumps(suggested,ensure_ascii=False),parse_status='ready',extract_status='done',review_status='processed',error=None)
    reindex_item(kid)
    return db.kb_get_item(kid)

def schedule_ingest(kid):
    item=db.kb_get_item(kid)
    if not item or item['parse_status'] in ('pending','parsing','extracting') or item['extract_status']=='running':return False
    if item['parse_status']=='ready':
        db.kb_update_item(kid,extract_status='running',error=None)
    else:
        db.kb_update_item(kid,parse_status='pending',error=None)
    return True

def parsed(kid):
    """Commit valid text before asking a model to structure it."""
    db.kb_update_item(kid,parse_status='ready',extract_status='running',error=None)
    reindex_item(kid)

def prepare_images(kid):
    from pathlib import Path
    from . import images
    from ..parse import write_atomic
    item=db.kb_get_item(kid)
    meta_path=store.kb_parse_paths(item['file_name'])[2]
    meta=json.loads(meta_path.read_text())
    try:
        if Path(item['file_name']).suffix.lower() in ('.docx','.pdf'):
            images.extract_images(store.kb_files_dir()/item['file_name'],item['file_name'])
        meta.pop('image_error',None)
    except Exception as error:
        meta['image_error']='证明图片提取失败：'+str(error)
    write_atomic(meta_path,json.dumps(meta,ensure_ascii=False))
    return {'error':meta.get('image_error')}

def fail(kid,stage,error):
    if stage=='extract':
        db.kb_update_item(kid,extract_status='failed',error=error)
    else:
        db.kb_update_item(kid,parse_status='failed',extract_status='pending',error=error)
    reindex_item(kid)
