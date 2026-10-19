from .errors import BusinessError, FileDownload, IncomingFile, Response
from .library_files import mutation_lock, replacement_upload
'知识库 API（v3 事实层）：上传/列表详情/AI整理/删除/图片查看。\n\n上传不选分类——类型由管线③判定，角色由类型派生。列表的 role 过滤是分组视图\n（事实类/写法类），不是检索边界（检索边界在工具层按角色加权）。写作素材在\n独立的素材库（/api/materials，用户手工勾选建块），知识库不做任何章节拆分。\n'
import hashlib
import json
import os
import shutil
import uuid
from pathlib import Path
from .. import db, company_store as cs
from ..config import MAX_UPLOAD_BYTES
from ..knowledge import store
from ..knowledge.freshness import freshness_warnings
from ..knowledge.ingest import reindex_item
from ..knowledge.availability import availability
from ..knowledge.types import FIELD_LABELS, get_type, role_of, type_name, types_payload
from ..parse.image import IMAGE_EXTS
KB_ALLOWED_EXTENSIONS = {'.docx', '.pdf'} | IMAGE_EXTS
_CHUNK = 1024 * 1024
CONVERSION_LABELS: dict[str, str] = {'docx-native': '样式标题（作者声明）', 'docx-numbered': '中文编号识别（标题印在原文）', 'pdf-toc': '书签目录（作者声明）', 'pdf-link-toc': '目录页超链接（作者自报）', 'pdf-printed-toc': '印刷目录页（作者自报）', 'pdf-numbered': '中文编号识别（标题印在原文）', 'pdf-plain': '未识别出结构', 'pdf-fontsize': '启发式（字号判级，旧版）', 'pdf-mixed': '混合（扫描页已转写）', 'vision': '视觉转写', 'txt-passthrough': '纯文本', 'md-passthrough': '纯文本'}

def _clean_name(raw: str) -> str | None:
    name = Path(raw).name.strip()
    if not name or name.startswith('.'):
        return None
    return name

async def list_types():
    return {'types': types_payload(), 'field_labels': FIELD_LABELS}

async def badge():
    return {'pending': db.kb_count_pending()}

async def upload_file(company_id: str, file: IncomingFile=None):
    cs.require_company(company_id)
    raw = file.filename or ''
    name = _clean_name(raw)
    if name is None:
        raise BusinessError(status_code=400, detail='文件名非法')
    ext = Path(name).suffix.lower()
    if ext not in KB_ALLOWED_EXTENSIONS:
        raise BusinessError(status_code=400, detail=f"不支持的文件类型：{ext or '(无扩展名)'}（允许 .docx/.pdf/.png/.jpg/.jpeg/.gif/.webp）")
    store.ensure_dirs()
    tmp = store.kb_files_dir() / f'.{name}.{uuid.uuid4().hex[:8]}.part'
    size = 0
    h = hashlib.sha256()
    try:
        with open(tmp, 'wb') as f:
            while True:
                chunk = await file.read(_CHUNK)
                if not chunk:
                    break
                size += len(chunk)
                if size > MAX_UPLOAD_BYTES:
                    raise BusinessError(status_code=413, detail='文件超过 100MB 上限')
                h.update(chunk)
                f.write(chunk)
        digest = h.hexdigest()
    except BaseException:
        try:
            tmp.unlink(missing_ok=True)
        except OSError:
            pass
        raise
    existing = db.kb_get_item_by_hash(digest)
    if existing:
        try:
            tmp.unlink(missing_ok=True)
        except OSError:
            pass
        raise BusinessError(status_code=409, detail=f"内容相同的文件已在知识库中：{existing['file_name']}（每份资料只存一份）")
    target = store.unique_file_path(name)
    os.replace(tmp, target)
    item = db.kb_insert_item(file_name=target.name, file_hash=digest, title=Path(target.name).stem, ext=ext)
    cs.attach_asset(item['id'],company_id)
    reindex_item(item['id'])
    return {'id': item['id'], 'file_name': target.name, 'size': size}

def _parse_meta_col(item: dict, key: str) -> dict | None:
    raw = item.get(key)
    if not raw:
        return None
    try:
        data = json.loads(raw)
        return data if isinstance(data, dict) else None
    except ValueError:
        return None

def _capability(state: dict) -> str:
    """按实际文字与字段派生能力，不把解析或核对状态当作内容证明。"""
    if not state['usable']:
        return 'stored'
    if not state['has_fields']:
        return 'searchable'
    return 'typed'

def _item_out(item: dict) -> dict:
    md_path, _, _, _ = store.kb_parse_paths(item['file_name'])
    suggested = _parse_meta_col(item, 'suggested_metadata')
    business = _parse_meta_col(item, 'business_metadata')
    doc_type = business.get('doc_type') if business and business.get('doc_type') else item.get('doc_type')
    state = availability(item)
    return {**{k: v for k, v in item.items() if k not in ('suggested_metadata', 'business_metadata', 'corrected_text')}, 'availability': state, 'doc_type': doc_type, 'doc_type_name': type_name(doc_type), 'role': role_of(doc_type), 'capability': _capability(state), 'suggested': suggested, 'business': business, 'check_result': _parse_meta_col(item, 'check_result'), 'freshness': freshness_warnings({'business_metadata': business, 'suggested_metadata': suggested}), 'md_ready': md_path.is_file()}

def _parse_summary(file_name: str) -> dict | None:
    _, outline_path, meta_path, _ = store.kb_parse_paths(file_name)
    if not meta_path.is_file():
        return None
    try:
        meta = json.loads(meta_path.read_text(encoding='utf-8'))
    except ValueError:
        return None
    if not isinstance(meta, dict):
        return None
    conv = meta.get('conversion') or '?'
    out: dict = {'conversion': conv, 'conversion_label': CONVERSION_LABELS.get(conv, conv), 'chars': meta.get('chars'), 'headings': meta.get('headings'), 'tables': meta.get('tables'), 'warnings': meta.get('warnings') or []}
    if meta.get('image_count') is not None:
        out['image_count'] = meta['image_count']
    if meta.get('image_error'):
        out['image_error'] = meta['image_error']
    if meta.get('pages') is not None:
        out['pages'] = meta['pages']
    if meta.get('scanned_pages'):
        out['scanned_pages'] = meta['scanned_pages']
    try:
        outline = json.loads(outline_path.read_text(encoding='utf-8')) if outline_path.is_file() else []
        out['top_sections'] = [n.get('标题') or '' for n in outline[:8] if isinstance(n, dict) and n.get('标题')]
    except ValueError:
        out['top_sections'] = []
    return out

async def list_items(q: str='', company_id: str='all', page: int=1, page_size: int=10, doc_type: str='', review_status: str=''):
    from .library_query import page_result, asset_list
    items=asset_list(q,company_id)
    if doc_type:items=[i for i in items if i['doc_type']==doc_type]
    if review_status:items=[i for i in items if (i['review_status']=='confirmed' if review_status=='confirmed' else i['review_status']!='confirmed')]
    result=page_result(items,page,page_size,'items')
    result['items']=[_item_out(item) for item in result['items']]
    return result

async def get_item(kid: str):
    item = db.kb_get_item(kid)
    if not item:
        raise BusinessError(status_code=404, detail='条目不存在')
    return {**_item_out(item), **_content_out(item)}

async def get_item_content(kid: str):
    item = db.kb_get_item(kid)
    if not item:
        raise BusinessError(status_code=404, detail='条目不存在')
    return _content_out(item)

def _content_out(item):
    md_path, outline_path, _, _ = store.kb_parse_paths(item['file_name'])
    text = md_path.read_text(encoding='utf-8') if md_path.is_file() else ''
    correction = item['corrected_text']
    from ..parse import outline_with_lines
    content = correction if correction is not None else text
    outline = outline_with_lines(content) if correction is not None else json.loads(outline_path.read_text()) if outline_path.is_file() else []
    return {'id': item['id'], 'revision': item['revision'], 'content':content, 'original_content':text, 'outline':outline, 'meta': _parse_summary(item['file_name'])}

async def get_item_raw(kid: str):
    """原件文件流（图片条目预览用）。"""
    item = db.kb_get_item(kid)
    if not item:
        raise BusinessError(status_code=404, detail='条目不存在')
    src = store.kb_files_dir() / item['file_name']
    if not src.is_file():
        raise BusinessError(status_code=404, detail='原件缺失')
    return FileDownload(src, filename=item['file_name'])

def _editable(kid: str, revision: int):
    item = db.kb_get_item(kid)
    if not item:
        raise BusinessError(404, '条目不存在，请重新读取资料库')
    cs.check_revision(item['revision'], revision)
    if item['parse_status'] in ('pending', 'parsing', 'extracting') or item['extract_status'] == 'running':
        raise BusinessError(409, '该资料正在识别，请处理结束后再操作')
    return item


def _reset_recognition(conn, kid: str):
    conn.execute("UPDATE kb_items SET doc_type=NULL,parse_status='pending',extract_status='pending',review_status='pending_review',suggested_metadata=NULL,business_metadata=NULL,check_result=NULL,progress=NULL,error=NULL,updated_at=? WHERE id=?", (db._now(), kid))
    conn.execute('INSERT INTO company_assets(item_id,revision) VALUES(?,1) ON CONFLICT(item_id) DO UPDATE SET corrected_text=NULL,revision=revision+1', (kid,))
    conn.execute('DELETE FROM kb_segments WHERE item_id=?', (kid,))


async def retrigger(kid: str, revision: int):
    """Discard derived content and run recognition from the original again."""
    with mutation_lock('kb', kid):
        with cs.transaction() as conn:
            item = _editable(kid, revision)
            parse_dir = store.kb_parse_dir(item['file_name'])
            if parse_dir.exists():
                shutil.rmtree(parse_dir)
            _reset_recognition(conn, kid)
        reindex_item(kid)
    return {'ok': True}


async def replace_file(kid: str, revision: int, file: IncomingFile):
    with mutation_lock('kb', kid):
        _editable(kid, revision)
        async with replacement_upload(file, store.kb_files_dir(), KB_ALLOWED_EXTENSIONS, MAX_UPLOAD_BYTES) as (temp, name, digest):
            target = None
            try:
                with cs.transaction() as conn:
                    item = _editable(kid, revision)
                    duplicate = conn.execute('SELECT id FROM kb_items WHERE file_hash=? AND id<>?', (digest, kid)).fetchone()
                    if duplicate:
                        raise BusinessError(409, '相同内容已在公司资料中，请使用已有资料')
                    target = store.unique_file_path(name)
                    os.replace(temp, target)
                    conn.execute('UPDATE kb_items SET file_name=?,file_hash=?,ext=? WHERE id=?', (target.name, digest, Path(name).suffix.lower(), kid))
                    _reset_recognition(conn, kid)
            except BaseException:
                if target is not None:
                    target.unlink(missing_ok=True)
                raise
            store.delete_item_files(item['file_name'])
        reindex_item(kid)
    return {'id': kid, 'file_name': target.name}


async def delete_item(kid: str, revision: int):
    with mutation_lock('kb', kid):
        with cs.transaction() as conn:
            item = _editable(kid, revision)
            conn.execute('DELETE FROM kb_items WHERE id=?', (kid,))
            conn.execute('DELETE FROM kb_segments WHERE item_id=?', (kid,))
        store.delete_item_files(item['file_name'])
    return {'ok': True}
