"""tender-body 正文阶段的路径与格式契约（check_pipeline / validate_body / SKILL.md 共用真值）。

目录产物（tender.directory）的树节点没有稳定 id——身份就是标题文本；正文文件与
节点的映射因此按「清洗后的标题」对账（清洗规则在此单一实现，工具与技能文档引用
同一份约定）。人工编辑器保存时通过明确的改名关系同步正文路径与制作记录；
模型重构目录后的归集仍须按真实正文核对，不猜测章节身份。
"""
from __future__ import annotations
import json
import hashlib
import re
GUIDE_RELPATH = 'body/写作指引.md'
PROMISE_RELPATH = 'body/关键事实与承诺.md'
GUIDE_NAME = GUIDE_RELPATH.rsplit('/', 1)[-1]
PROMISE_NAME = PROMISE_RELPATH.rsplit('/', 1)[-1]
VOLUME_PREFIX = '整本-'
MODES = ('素材修订', '格式跟随', '推理撰写')
NON_PROSE_DELIVERY = ('模板或附件填充', '目录容器')
PLACEHOLDER_MARKS = ('【待补', '【待澄清', '【待补充')
_ILLEGAL = re.compile('[\\\\/:*?\\"<>|\\r\\n\\t]')

def sanitize_name(title: str, limit: int=60) -> str:
    """标题 → 文件名/目录名：非法字符替换空格、折叠空白、去前导点、截断。

    清洗是对账的公共分母——工具按同一规则清洗两侧（叶子标题 vs 文件名）再比，
    因此规则变化只允许发生在这里。去前导点：`.` 开头的文件名会被
    workbench/本轮文件按隐藏文件隐掉而账面照算（账实不一致），且标题语义
    （如「.NET 方案」）在正文里完整保留、只影响文件名。
    """
    s = _ILLEGAL.sub(' ', title or '')
    s = re.sub('\\s+', ' ', s).strip()
    s = s.lstrip('.')
    return s[:limit].strip() or '未命名'

def volume_key(name: str) -> str:
    """册名用于存储时追加既有片段摘要，避免清洗或截断后互相覆盖。"""
    safe = sanitize_name(name)
    return safe + ('-' + hashlib.sha256(name.encode()).hexdigest()[:8] if safe != name else '')


def _iter_nodes(tree: list[dict]):
    for n in tree:
        yield n
        yield from _iter_nodes(n.get('children') or [])

def document_name(doc: dict) -> str:
    """册名身份：目录派发、合册与成果对账共用。"""
    return str(doc.get('name') or '').strip() or '主册'

def iter_leaves(content: dict) -> list[tuple[str, str, str]]:
    """产出 (册名, 节点标题, 交付形态)——每册目录树的叶子节点（无子节点）。

    防御性解析：目录/children 键可能缺失（产物内容是原始 dict 序列化，Pydantic
    只验证不物化默认值）。
    """
    out: list[tuple[str, str, str]] = []
    for doc in content.get('response_documents') or []:
        vol = document_name(doc)
        for n in _iter_nodes(doc.get('directory') or []):
            if n.get('children'):
                continue
            title = str(n.get('目录名称') or '').strip()
            if title:
                out.append((vol, title, str(n.get('交付形态') or '').strip()))
    return out


def body_delivery(node: dict, content: dict) -> str:
    """直接挂接格式模板的节点有自己的内容，不因挂了附件就成为空容器。"""
    mode = str(node.get('交付形态') or '').strip()
    registry = content.get('registry') or {}
    own_template = any(registry.get(rid, {}).get('type') == '模板'
                       for rid in node.get('来源位置') or [])
    return '模板或附件填充' if own_template and mode in ('', '目录容器') else mode


def body_nodes(content: dict, root, owned_paths=()) -> list[tuple[str, str, str]]:
    """正文目标：叶子、格式内容父节点，以及已有/记账的父正文。

    父节点的引言或尚未拆分的既有正文仍是内容，不能因增加子目录而消失。
    不要求原本只有结构的父节点新建空正文。
    """
    out = []
    for doc in content.get('response_documents') or []:
        vol = document_name(doc)
        prefix = volume_key(vol) + '/' if multi_volume(content) else ''
        for node in _iter_nodes(doc.get('directory') or []):
            title = str(node.get('目录名称') or '').strip()
            path = 'body/' + prefix + sanitize_name(title) + '.docx'
            mode = body_delivery(node, content)
            # 普通正文标签常由叶子沿用；增加子项不代表另写一份父正文。
            own_body = mode == '模板或附件填充' or any(
                (content.get('registry') or {}).get(rid, {}).get('type') == '模板'
                for rid in node.get('来源位置') or [])
            if title and (not node.get('children') or own_body or path in owned_paths or (root / path).is_file()):
                out.append((vol, title, mode))
    return out


def body_nodes_for_task(task_id, content):
    """已记账的父正文即使文件暂缺仍是应有内容；成功完整归集后才释放旧归属。"""
    from ..artifact_store import work_dir
    from ..services.build_state import read
    state = read(task_id)
    return body_nodes(content, work_dir(task_id), set(state.get('sections', {})) | set(state.get('pending_sections', {})))

def multi_volume(content: dict) -> bool:
    """多册判定：有目录树的响应文件多于一份。"""
    docs = content.get('response_documents') or []
    return len([d for d in docs if d.get('directory')]) > 1

def prose_leaves(content: dict) -> list[tuple[str, str, str]]:
    """需要正文文件的叶子：交付形态为 正文编写/混合/待核验/空（空=未标注，技能裁决）。"""
    return [(vol, title, mode) for vol, title, mode in iter_leaves(content) if mode not in NON_PROSE_DELIVERY]

def load_directory(task_id: str):
    """取任务内当前投标目录产物：(索引行, 内容 dict, content.json mtime)。

    无产物返回 (None, None, None)；包内容不可读返回 (row, None, None)
    ——调用方按事实报告，不在此裁决。
    """
    from .. import artifact_store, db
    row = db.find_artifact_index('tender.directory', 'tender-response-docs', 1, task_id=task_id)
    if not row:
        return (None, None, None)
    p = artifact_store.content_path(row['artifact_id'], row)
    try:
        content = json.loads(p.read_text(encoding='utf-8'))
        mtime = p.stat().st_mtime
    except (OSError, json.JSONDecodeError, ValueError):
        return (row, None, None)
    return (row, content, mtime)
