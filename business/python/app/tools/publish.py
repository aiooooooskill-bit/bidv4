"""LLM 面向的发布工具：把任务 _meta/staging/ 下的结构化草稿发布为产物。

授权与校验全部在 publish 管线（服务端硬约束）；本工具只做草稿读取、containment
（必须落在当前任务的 _meta/staging/ 内，防文档内容注入诱导读取敏感文件）与
移动消费（发布后草稿从暂存区移除，不留残骸）。

2026-08-31 重构语义：产物归任务；2026-09-04 两态移除——产物即单一当前版本，
发布即当前内容（重跑覆盖前自动留恢复点），无草稿/正式成果之分。
只接受明确注册的产物契约。
"""
import json
from pathlib import Path
from .. import artifact_store, contracts, publish, runctx
from ..config import workspace_dir
_DRAFT_MAX_BYTES = 10 * 1024 * 1024

def _resolve_draft(p: str) -> Path:
    """草稿路径 containment：解析（含符号链接）后必须落在当前任务的 _meta/staging/ 内。

    发布参数使用当前任务暂存文件的绝对路径，如 <当前任务绝对路径>/_meta/staging/x.json；
    解析器接受的相对路径按 workspace 根解析。
    不猜测或纠正缺失的路径。
    """
    ctx = runctx.current_run()
    task_id = ctx.task_id if ctx else None
    if not task_id:
        raise ValueError('缺少任务上下文：草稿目录在当前任务的 _meta/staging/ 下，请在任务会话中发布')
    root = workspace_dir().resolve()
    allowed = artifact_store.staging_dir(task_id).resolve()
    cand = Path(p).expanduser()
    if not cand.is_absolute():
        cand = root / cand
    resolved = cand.resolve()
    if not resolved.is_relative_to(root):
        raise ValueError(f'草稿路径越界：只允许 {allowed.relative_to(root)}/ 目录，收到 {p}')
    if not resolved.is_relative_to(allowed):
        raise ValueError(f'草稿路径不属于当前任务暂存目录：{p}；请使用 {allowed} 下的完整路径')
    return resolved

def publish_artifact(contract: str, draft_path: str, display_name: str='') -> str:
    """把当前任务 _meta/staging/ 下的 JSON 草稿发布为产物（登记后即用户可见可打开的成果）。

    使用方法：
    1. 先用文件工具把符合契约的 JSON 写到当前任务的 _meta/staging/ 目录（任务目录见任务
       上下文的「当前任务绝对路径」，如 <当前任务绝对路径>/_meta/staging/toc.json）；
    2. 再调用本工具登记发布（发布后草稿被移动消费）。发布前会做契约与内容结构校验，
       失败会返回原因。

    contract 为平台契约标识，当前可用：
    - tender.directory/tender-response-docs@1  投标目录
    - doc.note/note-md@1  通用笔记（title + body_md）
    未注册类型直接报错，不转换契约。

    产物是任务内该契约的当前版本：同契约已有成果时本次发布覆盖旧内容
    （旧内容自动留恢复点，用户可恢复上一版）。
    """
    try:
        path = _resolve_draft(draft_path)
    except ValueError as e:
        return f'[发布失败] {e}'
    if not path.is_file():
        return f'[发布失败] 草稿不存在：{draft_path}'
    try:
        size = path.stat().st_size
    except OSError as e:
        return f'[发布失败] 草稿读取失败：{e}'
    if size > _DRAFT_MAX_BYTES:
        return '[发布失败] 草稿超过 10MB 上限'
    try:
        content = json.loads(path.read_text(encoding='utf-8'))
    except ValueError as e:
        return f'[发布失败] 草稿不是合法 JSON：{e}'
    except OSError as e:
        return f'[发布失败] 草稿读取失败：{e}'
    contract_def = contracts.get_contract(contract)
    if contract_def is None:
        return f'[发布失败] 未注册的产物契约：{contract}'
    elif contract_def.content_type != 'application/json':
        return f'[发布失败] {contract_def.kind} 是文件型产物，不能经 JSON 草稿发布——它由对应工具（如合册 docx_assemble_volume）自动发布，无需手动操作；若要记录文字内容请改用 doc.note。'
    ctx = runctx.current_run()
    options_path = artifact_store.work_dir(ctx.task_id) / 'outline/.generation-options.json'
    if contract_def.kind == 'tender.directory':
        from ..services.page_flow import directory
        current = directory(ctx.task_id)
        settings = {k: current['content'][k] for k in ('page_target', 'numbering') if current and k in current['content']}
        if options_path.is_file():
            settings.update(json.loads(options_path.read_text()))
        content = {**content, **settings}
    try:
        meta = publish.publish_artifact(contract, content, display_name=display_name or None, source={'skill': 'direct', 'thread_id': ctx.conversation_id if ctx else None, 'run_id': ctx.run_id if ctx else None}, task_id=ctx.task_id if ctx else None, conversation_id=ctx.conversation_id if ctx else None)
    except Exception as e:
        return f'[发布失败] {e}'
    if contract_def.kind == 'tender.directory':
        options_path.unlink(missing_ok=True)
    try:
        path.unlink(missing_ok=True)
    except OSError:
        pass
    if meta.get('_unchanged'):
        return f"[发布完成] {meta['display_name']}（{meta['artifact_id']}）：内容与当前版本一致，未重复发布，当前成果保持不变。"
    suffix = '，已保存为当前成果。'
    return f"[发布成功] {meta['display_name']}（{meta['artifact_id']}）{suffix}"
