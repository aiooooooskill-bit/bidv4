from .errors import BusinessError, FileDownload, IncomingFile, Response
'类型化 Artifact 端点（artifact-system-design.md §6/§7，2026-09-04 两态移除）。\n\n- GET  /api/contracts                     平台契约目录元数据（客户端启动对账用）\n- GET  /api/artifacts                     索引列表（?task_id= 任务全部 / ?conversation_id= 按来源筛选）\n- GET  /api/artifacts/{aid}/meta          轻量探测（版本号，编辑器轮询用）\n- GET  /api/artifacts/{aid}/content       当前内容（application/json）\n- GET  /api/artifacts/{aid}/file          文件型产物原始字节（tender.volume docx）\n- PUT  /api/artifacts/{aid}/content       编辑保存（content_seq 探测 + force 用户裁决覆盖）\n- POST  /api/artifacts/{aid}/restore      恢复上一版（恢复点安全网）\n\n并发策略遵循文件夹语义：发布即覆盖（覆盖前留恢复点），无编辑租约；\n编辑器轮询探测外部更新，冲突由用户在客户端二选一裁决。\n'
import json
import hashlib
from datetime import datetime, timezone
from pydantic import BaseModel
from .. import artifact_store, contracts, db
from .edit_guard import require_idle

def _now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec='seconds')

class ContentUpdate(BaseModel):
    content: object
    base_content_seq: int
    force: bool = False

async def list_contracts():
    return {'contracts': [{'key': c.key, 'kind': c.kind, 'schema_id': c.schema_id, 'schema_version': c.schema_version, 'cardinality': c.cardinality, 'llm_write_mode': c.llm_write_mode, 'editable': c.editable, 'default_display_name': c.default_display_name} for c in contracts.list_contracts()]}

def _to_api(row: dict) -> dict:
    contract = contracts.get_contract(f"{row['kind']}/{row['schema_id']}@{row['schema_version']}")
    task_id = row.get('task_id')
    conversation_id = row.get('conversation_id')
    return {'artifact_id': row['artifact_id'], 'display_name': row['display_name'], 'kind': row['kind'], 'schema_id': row['schema_id'], 'schema_version': row['schema_version'], 'cardinality': row['cardinality'], 'editable': contract.editable if contract else False, 'content_type': contract.content_type if contract else 'application/json', 'updated_at': row['updated_at'], 'content_seq': row['content_seq'], 'restore_available': artifact_store.has_restore_point(row['artifact_id'], row), 'source': {'thread_id': row['last_thread_id'], 'run_id': row['last_run_id']}, 'task_id': task_id, 'conversation_id': conversation_id, 'path': str(artifact_store.content_path(row['artifact_id'], row))}

async def list_artifacts(task_id: str | None=None, conversation_id: str | None=None):
    rows = db.list_artifact_index(task_id=task_id, conversation_id=conversation_id)
    arts = [_to_api(r) for r in rows if artifact_store.package_ready(r['artifact_id'], r)]
    return {'artifacts': arts}

async def get_artifact_meta(aid: str):
    """轻量探测：编辑器轮询外部更新只比版本号，不拉全量列表/全文。"""
    row = db.get_artifact_index(aid)
    if not row:
        raise BusinessError(status_code=404, detail='产物不存在')
    return {'artifact_id': aid, 'content_seq': row['content_seq']}

async def get_artifact_content(aid: str):
    row = db.get_artifact_index(aid)
    if not row:
        raise BusinessError(status_code=404, detail='产物不存在')
    p = artifact_store.resolved_content_path(aid, row)
    if p is None:
        raise BusinessError(status_code=410, detail='产物路径越界，已拒绝读取')
    if not p.is_file():
        raise BusinessError(status_code=410, detail='产物文件已不存在')
    return Response(content=p.read_bytes(), media_type='application/json; charset=utf-8')

async def get_artifact_file(aid: str, format: str = 'docx'):
    """按当前元信息下载Word并验证字节，预览与下载共用。"""
    row = db.get_artifact_index(aid)
    if not row:
        raise BusinessError(status_code=404, detail='产物不存在')
    if format != 'docx':
        raise BusinessError(status_code=422, detail='仅支持Word（docx）导出')
    files = artifact_store.package_files(aid, row, '*.' + format)
    if not files:
        raise BusinessError(status_code=410, detail='产物包内没有文件（或路径越界）')
    try:
        meta = json.loads(artifact_store.read_content_resolved(aid, row) or '{}')
    except ValueError:
        raise BusinessError(status_code=410, detail='产物文件记录已损坏')
    want = meta.get('filename') if isinstance(meta, dict) else None
    target = next((f for f in files if f.name == want), None)
    if target is None:
        raise BusinessError(status_code=410, detail='产物登记的文档已不存在')
    expected = meta.get('sha256')
    if not expected or hashlib.sha256(target.read_bytes()).hexdigest() != expected:
        raise BusinessError(status_code=409, detail='导出文档已变化，请重新合册后下载')
    contract = contracts.get_contract(f"{row['kind']}/{row['schema_id']}@{row['schema_version']}")
    media = contract.content_type if contract else 'application/octet-stream'
    return FileDownload(target, media_type=media, filename=f"{row['display_name']}.{format}", headers={'X-Content-Type-Options': 'nosniff'})

async def update_artifact_content(aid: str, body: ContentUpdate):
    """编辑保存：非 force 时 content_seq 不匹配返回 409（探测信号，客户端弹「拉取最新/保留我的」）；
    force 时无条件覆盖（被顶掉的内容留恢复点）。schema 校验始终执行。"""
    row = db.get_artifact_index(aid)
    if not row:
        raise BusinessError(status_code=404, detail='产物不存在')
    if row.get('task_id'):
        require_idle(row['task_id'])
    if not artifact_store.package_ready(aid, row):
        raise BusinessError(status_code=410, detail='产物包已不存在')
    if not body.force and body.base_content_seq != row['content_seq']:
        raise BusinessError(status_code=409, detail=f"内容已被其他修改更新（当前版本号 {row['content_seq']}），请选择拉取最新或保留你的版本")
    contract = contracts.get_contract(f"{row['kind']}/{row['schema_id']}@{row['schema_version']}")
    if contract is None:
        raise BusinessError(status_code=422, detail=f"契约 {row['kind']} 已不可用，无法保存")
    if not contract.editable:
        raise BusinessError(status_code=409, detail=f"「{row['display_name']}」是交付物，内容不可编辑")
    try:
        contract.model.model_validate(body.content)
    except Exception as e:
        raise BusinessError(status_code=422, detail=f"内容不符合契约：{str(e).replace(chr(10), ' ')[:300]}")
    content_text = json.dumps(body.content, ensure_ascii=False, indent=2)
    with artifact_store.write_lock():
        row = db.get_artifact_index(aid)
        if row is None:
            raise BusinessError(status_code=404, detail='产物不存在')
        if not artifact_store.package_ready(aid, row):
            raise BusinessError(status_code=410, detail='产物包已不存在')
        if not body.force and body.base_content_seq != row['content_seq']:
            raise BusinessError(status_code=409, detail=f"内容已被其他修改更新（当前版本号 {row['content_seq']}），请选择拉取最新或保留你的版本")
        if body.force:
            prev = artifact_store.read_content_resolved(aid, row)
            if prev is not None:
                artifact_store.save_restore_point(aid, row, row['content_seq'], prev)
        artifact_store.replace_current_content(aid, row, content_text)
        new_seq = row['content_seq'] + 1
        updated_at = _now()
        db.upsert_artifact_index({**row, 'content_seq': new_seq, 'updated_at': updated_at})
    return {'ok': True, 'content_seq': new_seq, 'updated_at': updated_at}
