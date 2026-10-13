from .errors import BusinessError, FileDownload, IncomingFile, Response
"""任务文件区 API（PRD §2 / artifact-system-design.md §16）：上传 / 列表 / 删除。

文件落在当前任务的 sources/ 子目录（workspace/<task_id>/sources/，2026-08-31 产物
模型重构：只读来源区）——跨任务同名文件互不影响；task_id 必填（无任务上下文的前端
禁止上传）。100MB 上限 + 任务内同名覆盖。上传只支持当前项目明确的七类来源格式。
"""
import mimetypes
import os
import uuid
from datetime import datetime, timezone
from pathlib import Path
from .. import artifact_store, db
from ..config import MAX_UPLOAD_BYTES
from .edit_guard import require_idle
from .page_flow import source_selection, set_sources
ALLOWED_EXTENSIONS = {'.docx', '.pdf', '.png', '.jpg', '.jpeg', '.gif', '.webp'}
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

async def upload_file(task_id: str, file: IncomingFile=None):
    _require_task(task_id)
    require_idle(task_id)
    raw = file.filename or ''
    name = _clean_name(raw)
    if name is None:
        raise BusinessError(status_code=400, detail='文件名非法')
    if Path(name).suffix.lower() not in ALLOWED_EXTENSIONS:
        raise BusinessError(status_code=415, detail='仅支持 DOCX、PDF、PNG、JPG、JPEG、GIF、WebP')
    target_dir = artifact_store.sources_dir(task_id)
    target_dir.mkdir(parents=True, exist_ok=True)
    previous = [p.name for p in target_dir.iterdir() if p.is_file() and not p.name.startswith('.')]
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
                if size > MAX_UPLOAD_BYTES:
                    raise BusinessError(status_code=413, detail='文件超过 100MB 上限')
                f.write(chunk)
        require_idle(task_id)
        os.replace(tmp, target)
        if not source_selection(task_id)['main']:
            if not previous:
                set_sources(task_id, name, [])
            elif len(previous) == 1:
                set_sources(task_id, previous[0], [])
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
    require_idle(task_id)
    target.unlink()
    return {'ok': True}
