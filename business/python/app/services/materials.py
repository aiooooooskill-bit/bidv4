from .errors import BusinessError, FileDownload, IncomingFile, Response
from .library_files import mutation_lock, replacement_upload
"""写作素材库 API（v2 手工构建）：文件上传/解析、目录树、块 CRUD。

素材块 = 用户在目录树上勾选的章节区间集合 + 备注；与知识库彻底分离
（自己的文件、自己的解析、零 LLM）。块检索段复用 kb_segments（mt_ 前缀隔离）。
"""
import hashlib
import os
import uuid
from pathlib import Path
from pydantic import BaseModel, Field
from .. import db
from ..knowledge import materials_lib as mlib

class BlockUpdateBody(BaseModel):
    """块标题/备注的边界校验（2026-09-17 批次⑦）：裸 dict 时代传 {"title": 123}
    会在 mlib.update_block 的 title.strip() 处 AttributeError 打穿 500——「错误一律
    人话」的接口约定在边界就挡掉；长度上限与 mlib 落盘截断同口径。"""
    title: str | None = Field(default=None, max_length=120)
    note: str | None = Field(default=None, max_length=2000)
MT_ALLOWED_EXTENSIONS = {'.docx'}
_MT_EXTENSION_HINT = '素材库只收 .docx（历史标书原文，支持图表整体拷贝）——PDF/老 .doc 范文请先用 Word 打开，另存为 .docx 再传'
_CHUNK = 1024 * 1024

def _clean_name(raw: str) -> str | None:
    name = Path(raw).name.strip()
    if not name or name.startswith('.'):
        return None
    return name

def _file_out(f: dict, block_count: int | None=None) -> dict:
    out = {**f}
    if block_count is not None:
        out['block_count'] = block_count
    return out

async def upload_file(file: IncomingFile=None):
    raw = file.filename or ''
    name = _clean_name(raw)
    if name is None:
        raise BusinessError(status_code=400, detail='文件名非法')
    ext = Path(name).suffix.lower()
    if ext not in MT_ALLOWED_EXTENSIONS:
        raise BusinessError(status_code=400, detail=_MT_EXTENSION_HINT)
    mlib.ensure_dirs()
    tmp = mlib.mt_files_dir() / f'.{name}.{uuid.uuid4().hex[:8]}.part'
    size = 0
    h = hashlib.sha256()
    try:
        with open(tmp, 'wb') as f:
            while True:
                chunk = await file.read(_CHUNK)
                if not chunk:
                    break
                size += len(chunk)
                h.update(chunk)
                f.write(chunk)
        digest = h.hexdigest()
    except BaseException:
        try:
            tmp.unlink(missing_ok=True)
        except OSError:
            pass
        raise
    existing = db.mt_get_file_by_hash(digest)
    if existing:
        try:
            tmp.unlink(missing_ok=True)
        except OSError:
            pass
        raise BusinessError(status_code=409, detail=f"内容相同的文件已在素材库中：{existing['file_name']}")
    target = mlib.unique_file_path(name)
    os.replace(tmp, target)
    f = db.mt_insert_file(file_name=target.name, file_hash=digest)
    mlib.schedule_parse(f['id'])
    return {'id': f['id'], 'file_name': target.name, 'size': size}

async def list_files():
    counts = db.mt_block_counts()
    return {'files': [_file_out(f, counts.get(f['id'], 0)) for f in db.mt_list_files()]}

async def get_outline(fid: str):
    """目录树（勾选界面数据源：全层级带行号；无结构时空表）。"""
    f = db.mt_get_file(fid)
    if not f:
        raise BusinessError(status_code=404, detail='素材文件不存在')
    return {'id': fid, 'outline': mlib.read_outline(fid), 'parse_status': f['parse_status'], 'error': f.get('error')}

def _editable_file(fid: str, file_hash: str | None = None):
    f = db.mt_get_file(fid)
    if not f:
        raise BusinessError(404, '素材文件不存在，请重新读取资料库')
    if file_hash is not None and f['file_hash'] != file_hash:
        raise BusinessError(409, '来源文件已被更换，请重新读取后再操作')
    if f['parse_status'] in ('pending', 'parsing'):
        raise BusinessError(409, '来源文件正在解析，请稍候再操作')
    return f


async def replace_file(fid: str, file_hash: str, file: IncomingFile):
    with mutation_lock('mt', fid):
        _editable_file(fid, file_hash)
        async with replacement_upload(file, mlib.mt_files_dir(), MT_ALLOWED_EXTENSIONS, None) as (temp, name, digest):
            target = None
            try:
                from ..company_store import transaction
                with transaction() as conn:
                    old = _editable_file(fid, file_hash)
                    if conn.execute('SELECT id FROM mt_files WHERE file_hash=? AND id<>?', (digest, fid)).fetchone():
                        raise BusinessError(409, '相同内容已在写作素材库中，请使用已有文件')
                    target = mlib.unique_file_path(name)
                    os.replace(temp, target)
                    conn.execute("UPDATE mt_files SET file_name=?,file_hash=?,parse_status='pending',error=NULL,updated_at=? WHERE id=?", (target.name, digest, db._now(), fid))
                    conn.execute('DELETE FROM mt_blocks WHERE file_id=?', (fid,))
                    conn.execute('DELETE FROM kb_segments WHERE item_id=?', (fid,))
            except BaseException:
                if target is not None:
                    target.unlink(missing_ok=True)
                raise
            mlib.delete_file_disk(old['file_name'])
    mlib.schedule_parse(fid)
    return {'id': fid, 'file_name': target.name}


async def delete_file(fid: str, file_hash: str):
    with mutation_lock('mt', fid):
        _editable_file(fid, file_hash)
        mlib.delete_file(fid)
    return {'ok': True}


async def reparse_file(fid: str):
    _editable_file(fid)
    mlib.schedule_parse(fid)
    return {'ok': True}

async def get_file_raw(fid: str):
    """原件文件流（预览「原件」模式：docx/pdf 版式渲染，文件不出本机）。"""
    f = db.mt_get_file(fid)
    if not f:
        raise BusinessError(status_code=404, detail='素材文件不存在')
    src = mlib.mt_files_dir() / f['file_name']
    if not src.is_file():
        raise BusinessError(status_code=404, detail='原件缺失')
    return FileDownload(src, filename=f['file_name'])

async def get_file_preview(fid: str):
    from ..knowledge.material_preview import build_preview
    f = db.mt_get_file(fid)
    if not f:
        raise BusinessError(404, '素材文件不存在')
    if not (mlib.mt_files_dir() / f['file_name']).is_file():
        raise BusinessError(404, '原件缺失')
    if f['parse_status'] != 'ready':
        raise BusinessError(422, '文件尚未解析完成，请先重新解析文件。')
    try:
        preview = build_preview(f)
    except ValueError as error:
        raise BusinessError(422, str(error)) from error
    return FileDownload(preview, filename=f['file_name'], media_type='application/vnd.openxmlformats-officedocument.wordprocessingml.document')

def _matching_blocks(q: str, file_id: str, files: dict) -> list[dict]:
    from ..knowledge.fts import build_match_expr
    expr=build_match_expr(q) if q.strip() else None
    hits=db.kb_search_segments(expr,limit=100000,domain='mt') if expr else []
    ranks={}
    for hit in hits:ranks.setdefault(hit['material_id'],hit['rank'])
    items=[]
    for b in db.mt_list_blocks():
        if b['file_id'] not in files or (file_id and b['file_id']!=file_id):continue
        if q.strip() and b['id'] not in ranks and q.strip().lower() not in (b['title']+' '+b['note']).lower():continue
        items.append({**b,'file_name':files[b['file_id']]['file_name']})
    if q.strip():items.sort(key=lambda b:ranks.get(b['id'],0))
    return items

async def list_blocks(q: str='', file_id: str='', page: int=1, page_size: int=10):
    from .library_query import page_result
    files={f['id']:f for f in db.mt_list_files()}
    return page_result(_matching_blocks(q,file_id,files),page,page_size,'blocks')

async def list_items(q: str='', file_id: str='', page: int=1, page_size: int=10):
    """资料库左侧清单：未建块原件与可用素材统一筛选、分页，原件不重复列出。"""
    from .library_query import page_result
    files={f['id']:f for f in db.mt_list_files()}
    counts=db.mt_block_counts()
    pending=[{**f,'kind':'file','block_count':0} for f in files.values()
             if not counts.get(f['id'],0) and (not file_id or f['id']==file_id)
             and (not q.strip() or q.strip().lower() in f['file_name'].lower())]
    blocks=[{**b,'kind':'block','parse_status':files[b['file_id']]['parse_status'],
             'source_error':files[b['file_id']].get('error')}
            for b in _matching_blocks(q,file_id,files)]
    return page_result(pending+blocks,page,page_size,'items')

async def get_block(bid: str):
    block=db.mt_get_block(bid)
    if not block:raise BusinessError(404,'素材块不存在')
    file=db.mt_get_file(block['file_id'])
    return {**block,'file_name':file['file_name']}

async def get_block_content(bid: str, preview: int | None=None):
    """块内容预览：分节切片（区间标签 + 正文），卡片展开区数据源。

    preview（可选，2026-09-13 内存修复批）：行内预览预算（字符）——设定时
    sections 正文按累计预算截断（合计 ≤ preview、预算耗尽即停），chars 仍为
    真实总字数；供写作指引表等「每行只显示百来字」的消费方避免整块拉全文
    （几十个块的全量内容同时驻留内存）。不传行为不变。
    """
    content = mlib.block_content(bid)
    if not content:
        raise BusinessError(status_code=404, detail='素材块不存在')
    if preview is not None:
        if preview < 1:
            raise BusinessError(status_code=422, detail='preview 须为正整数')
        content = _truncate_preview(content, preview)
    return content

def _truncate_preview(content: dict, budget: int) -> dict:
    """按累计预算截断 sections 正文（chars 保留真实总字数），预算耗尽即停。"""
    out: list[dict] = []
    used = 0
    for sec in content.get('sections') or []:
        room = max(0, budget - used)
        out.append({**sec, 'text': sec['text'][:room]})
        used += len(sec['text'])
        if used >= budget:
            break
    return {**content, 'sections': out}
async def create_block(fid: str, body: dict):
    """建块：{title, note, ranges: [[s,e],…]}——ranges 来自勾选节点的行号区间
    （可勾父子节点，服务端嵌套去重叠；区间须有效）。"""
    with mutation_lock('mt', fid):
        f = db.mt_get_file(fid)
        if not f:
            raise BusinessError(status_code=404, detail='素材文件不存在')
        if f['parse_status'] != 'ready':
            raise BusinessError(status_code=422, detail='文件尚未解析完成，稍候再试')
        ranges = body.get('ranges')
        if not isinstance(ranges, list) or not ranges:
            raise BusinessError(status_code=422, detail='ranges 须为非空的 [[起始行,结束行],…] 列表')
        block = mlib.create_block(fid, str(body.get('title') or ''), str(body.get('note') or ''), ranges)
        if not block:
            raise BusinessError(status_code=422, detail='区间全部无效（行号越界或为空）')
        return block

async def update_block(bid: str, body: BlockUpdateBody):
    block = db.mt_get_block(bid)
    if not block:
        raise BusinessError(404, '素材块不存在，请重新读取资料库')
    with mutation_lock('mt', block['file_id']):
        _editable_file(block['file_id'])
        block = mlib.update_block(bid, body.title, body.note)
        if not block:
            raise BusinessError(404, '素材块不存在，请重新读取资料库')
    return block


async def delete_block(bid: str):
    block = db.mt_get_block(bid)
    if not block:
        raise BusinessError(404, '素材块不存在，请重新读取资料库')
    with mutation_lock('mt', block['file_id']):
        _editable_file(block['file_id'])
        if not mlib.delete_block(bid):
            raise BusinessError(404, '素材块不存在，请重新读取资料库')
    return {'ok': True}
