from .errors import BusinessError, FileDownload, IncomingFile, Response
"""任务文件区 API（PRD §2 / artifact-system-design.md §16）：上传 / 列表 / 删除。

文件落在当前任务的 sources/ 子目录（workspace/<task_id>/sources/，2026-08-31 产物
模型重构：只读来源区）——跨任务同名文件互不影响；task_id 必填（无任务上下文的前端
禁止上传）。招标来源100MB上限，受审投标文件不设大小上限；任务内同名覆盖。
"""
import mimetypes
import os
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Literal
from .. import artifact_store, db
from ..config import MAX_UPLOAD_BYTES
from ..file_lock import file_lock
from ..parse import write_atomic
import json
from .edit_guard import require_idle
from .page_flow import source_selection, set_sources
ALLOWED_EXTENSIONS = {'.docx', '.pdf', '.xls', '.xlsx', '.png', '.jpg', '.jpeg', '.gif', '.webp'}
_CHUNK = 1024 * 1024

def _clean_name(raw: str) -> str | None:
    """清洗文件名：去路径分隔符、拒绝空名/点开头隐藏文件（含 `..`，PRD 已知坑 #6）。"""
    name = Path(raw).name.strip()
    if not name or name.startswith('.'):
        return None
    return name

def _require_task(task_id: str) -> None:
    if not db.get_task(task_id):
        raise BusinessError(status_code=404, detail='任务不存在')

async def upload_file(task_id: str, file: IncomingFile=None, purpose: Literal['source', 'bid']='source', replace_name: str=''):
    _require_task(task_id)
    require_idle(task_id)
    raw = file.filename or ''
    name = _clean_name(raw)
    if name is None:
        raise BusinessError(status_code=400, detail='文件名非法')
    if Path(name).suffix.lower() not in ALLOWED_EXTENSIONS:
        raise BusinessError(status_code=415, detail='仅支持 DOCX、PDF、XLS、XLSX、PNG、JPG、JPEG、GIF、WebP')
    target_dir = artifact_store.sources_dir(task_id)
    target_dir.mkdir(parents=True, exist_ok=True)
    target = target_dir / name
    existed = target.exists()
    tmp = target_dir / f'.{name}.{uuid.uuid4().hex[:8]}.part'
    size = 0
    try:
        with open(tmp, 'wb') as f:
            while True:
                chunk = await file.read(_CHUNK)
                if not chunk:
                    break
                size += len(chunk)
                if purpose == 'source' and size > MAX_UPLOAD_BYTES:
                    raise BusinessError(status_code=413, detail='文件超过 100MB 上限')
                f.write(chunk)
        with file_lock(target_dir):
            require_idle(task_id)
            from .review import selection as review_selection
            bids = review_selection(task_id)['bids']
            selected = source_selection(task_id)
            old_name = replace_name or name
            if replace_name and (_clean_name(replace_name) != replace_name or not (target_dir / replace_name).is_file()):
                raise BusinessError(409, '待替换文件已变化，请刷新后重试')
            if replace_name and name != replace_name and target.exists():
                raise BusinessError(409, '项目已有同名文件，请选择该文件的替换入口')
            tender_names = [selected['main'], *[s['file'] for s in selected['supplements']]]
            if purpose == 'source' and old_name in bids or purpose == 'bid' and old_name in tender_names:
                raise BusinessError(422, '招标来源与受审投标文件必须使用不同名称')
            previous = [p.name for p in target_dir.iterdir() if p.is_file() and not p.name.startswith('.') and p.name not in bids]
            backup = target_dir / f'.{name}.{uuid.uuid4().hex}.backup'
            if target.exists():
                os.link(target, backup)
            try:
                os.replace(tmp, target)
                if purpose == 'source':
                    main = name if selected['main'] == old_name or not selected['main'] and not previous else selected['main']
                    supplements = [name if s['file'] == old_name else s['file'] for s in selected['supplements']]
                    # Same-name replacement preserves an explicit exclusion; a new source joins by default.
                    if main != name and name not in supplements and not replace_name and not existed:
                        supplements.append(name)
                    set_sources(task_id, main, supplements)
                if replace_name and old_name != name:
                    (target_dir / old_name).unlink()
            except BaseException:
                if backup.exists():
                    os.replace(backup, target)
                else:
                    target.unlink(missing_ok=True)
                write_atomic(artifact_store.work_dir(task_id) / 'parse/sources.json', json.dumps(selected, ensure_ascii=False))
                raise
            finally:
                backup.unlink(missing_ok=True)
    except BaseException:
        try:
            tmp.unlink(missing_ok=True)
        except OSError:
            pass
        raise
    return {'name': name, 'size': size, 'overwritten': existed}

async def list_files(task_id: str):
    _require_task(task_id)
    files_dir = artifact_store.sources_dir(task_id)
    files = []
    if files_dir.is_dir():
        for p in sorted(files_dir.iterdir()):
            if p.is_file() and (not p.name.startswith('.')):
                st = p.stat()
                files.append({'name': p.name, 'abs_path': str(p), 'size': st.st_size, 'modified_at': datetime.fromtimestamp(st.st_mtime, timezone.utc).isoformat(timespec='microseconds')})
    return {'files': files}

async def read_file_raw(name: str, task_id: str):
    """来源原件原始字节：面板预览用（pdf/docx 在浏览器本地渲染，文件不出本机）。
    containment 与 delete_file 同款；不设扩展白名单——但**恒 attachment 下发**
    （前端 fetch+blob 预览不受影响；inline 会把上传的 html/svg 在浏览器模式下
    于 sidecar 同源渲染，构成存储型 XSS——kb raw 端点同先例）。"""
    _require_task(task_id)
    clean = _clean_name(name)
    if clean is None:
        raise BusinessError(status_code=400, detail='文件名非法')
    files_dir = artifact_store.sources_dir(task_id).resolve()
    target = (files_dir / clean).resolve()
    if not target.is_relative_to(files_dir) or not target.is_file():
        raise BusinessError(status_code=404, detail='文件不存在')
    media_type = mimetypes.guess_type(target.name)[0] or 'application/octet-stream'
    return FileDownload(target, filename=target.name, media_type=media_type, headers={'X-Content-Type-Options': 'nosniff'})

async def delete_file(name: str, task_id: str):
    _require_task(task_id)
    clean = _clean_name(name)
    if clean is None:
        raise BusinessError(status_code=400, detail='文件名非法')
    files_dir = artifact_store.sources_dir(task_id).resolve()
    target = (files_dir / clean).resolve()
    if not target.is_relative_to(files_dir) or not target.is_file():
        raise BusinessError(status_code=404, detail='文件不存在')
    with file_lock(files_dir):
        require_idle(task_id)
        selected = source_selection(task_id)
        from .review import selection as review_selection
        review = review_selection(task_id)
        tombstone = files_dir / f'.{clean}.{uuid.uuid4().hex}.removed'
        os.replace(target, tombstone)
        try:
            set_sources(task_id, '' if selected['main'] == clean else selected['main'], [s['file'] for s in selected['supplements'] if s['file'] != clean])
            if clean in review['bids']:
                write_atomic(artifact_store.work_dir(task_id) / 'review/input.json', json.dumps({**review, 'bids': [n for n in review['bids'] if n != clean]}, ensure_ascii=False))
        except BaseException:
            os.replace(tombstone, target)
            write_atomic(artifact_store.work_dir(task_id) / 'parse/sources.json', json.dumps(selected, ensure_ascii=False))
            raise
        tombstone.unlink()
    return {'ok': True}


async def preview_excel(name: str, task_id: str, sheet: int=0, offset: int=0):
    _require_task(task_id)
    clean = _clean_name(name)
    if clean != name or Path(name).suffix.lower() not in {'.xls', '.xlsx'}:
        raise BusinessError(415, '请选择 XLS 或 XLSX 文件')
    source = artifact_store.sources_dir(task_id) / name
    if not source.is_file():
        raise BusinessError(404, '文件不存在')
    from ..parse.excel import read_workbook, column_name
    try:
        with file_lock(artifact_store.sources_dir(task_id)):
            sheets = read_workbook(source)
    except ValueError as error:
        raise BusinessError(422, str(error)) from error
    if not 0 <= sheet < len(sheets) or offset < 0:
        raise BusinessError(422, '工作表或行范围无效')
    current = sheets[sheet]
    return {'sheets': [{'name': s['name'], 'hidden': s['hidden']} for s in sheets], 'sheet': sheet,
            'columns': [column_name(i + 1) for i in range(current['columns'])], 'rows': current['rows'][offset:offset + 100],
            'offset': offset, 'total': len(current['rows']), 'warnings': current['warnings']}
