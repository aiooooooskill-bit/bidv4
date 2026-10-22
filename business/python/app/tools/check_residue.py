"""旧名残留机械扫描（拷贝修订模式的第一道防线，行业第一大事故=提交稿残留旧
机构/旧项目名）。纯确定性检查，零 LLM：扫描表按来源分两级（可靠度不同）：
- 硬级（真旧名，必须替换）：old_names 显式名单 + 来源条目元数据的项目名/客户名
- 弱级（可能误报）：来源文件名主干（项目名常混通用产品词，如「流程管理」）
拷整章后必须调用。"""
from __future__ import annotations
from pathlib import Path
import re
from .. import db, runctx
from ..knowledge.roles import item_meta

def scan_residue(lines: list[str], names: list[str], labels: list[str] | None=None) -> list[str]:
    """逐名扫描行，返回告警文案块（纯函数：check_name_residue 与 validate_body 共用）。

    names 由调用方组装（硬级/弱级分别调用），这里只做行级子串扫描；labels
    逐行给定位（docx 节传 P 段号/T 行号——与 docx_section_read 视图互查），
    缺省 L 行号。
    """
    found: list[str] = []
    for name in names:
        hits: list[str] = []
        for i, ln in enumerate(lines, 1):
            if name in ln:
                ctx = ln.strip()
                loc = labels[i - 1] if labels and i <= len(labels) else f'L{i}'
                hits.append(f"{loc}：{ctx[:60]}{('…' if len(ctx) > 60 else '')}")
        if hits:
            found.append(f'残留「{name}」× {len(hits)} 处：' + '；'.join(hits[:5]))
    return found

def _split_stem(file_name: str) -> list[str]:
    """文件名主干词（≥4 字）——弱级来源（项目名常混通用产品词，可能误报）。"""
    import re
    stem = Path(file_name).stem
    return [p for p in re.split('[\\s（）()\\-_—【】\\[\\]]+', stem) if p]

def check_name_residue(text: str, source_item_id: str | None=None, old_names: list[str] | None=None) -> str:
    """扫描文本中残留的旧项目名/旧客户名/旧机构名（整章拷贝修订后必须调用）。

    扫描表按来源分两级：硬级 = old_names 显式名单 + 来源条目的项目名/客户名
    （真旧名，必须替换）；弱级 = 来源文件名主干（可能为通用产品术语，逐条核对）。
    返回残留位置（行号+上下文）清单；无残留返回通过。
    Args:
        text: 待检查的正文（拷贝来的章节/段落）
        source_item_id: 可选，来源条目 id——知识库条目（kb: 前缀，自动取项目名/
                        客户名入硬级）或素材库文件（mt: 前缀，文件名主干入弱级）
        old_names: 可选，额外显式名单（旧机构名、旧项目简称等，入硬级）
    """
    try:
        hard: list[str] = [n.strip() for n in old_names or [] if isinstance(n, str) and len(n.strip()) >= 2]
        soft: list[str] = []
        if source_item_id:
            item = db.kb_get_item(source_item_id)
            file_name = None
            if item:
                file_name = item['file_name']
                for code in ('project_name', 'client'):
                    v = item_meta(item, code)
                    if v and len(v) >= 2:
                        hard.append(v)
            else:
                mt_file = db.mt_get_file(source_item_id)
                if mt_file:
                    file_name = mt_file['file_name']
            if file_name:
                soft += [p for p in _split_stem(file_name) if len(p) >= 4]

        # 当前已确认主体不能被模型误传的old_names升级为“必须全部替换”。
        # 只排除精确相同的当前名称，过期快照及包含当前名的其他旧名称仍扫描。
        current = runctx.current_run()
        protected = set()
        if current and current.task_id:
            from ..services import bidder
            state = bidder.status(current.task_id)
            if state.get('confirmed') and not state.get('stale'):
                snapshot = state.get('snapshot') or {}
                protected = {value['name'] for key in ('company', 'signer')
                             if (value := snapshot.get(key) or {}).get('name')}
            from ..artifact_store import work_dir
            from ..services import build_state
            from ..promises import promise_rows, unconfirmed
            from .body_contract import PROMISE_NAME
            promise_path = work_dir(current.task_id) / 'body' / PROMISE_NAME
            prepared = build_state.read(current.task_id).get('promises')
            if (promise_path.is_file() and prepared
                    and prepared == build_state.preparation_stamp(current.task_id, 'promises')):
                protected.update(row.value for row in promise_rows(promise_path.read_text(encoding='utf-8'))[0]
                                 if row.item in ('采购人', '项目名称', '招标编号', '项目编号') and not unconfirmed(row.value))
            # 仅去法定组织后缀得到精确简称；不屏蔽包含简称的旧项目名。
            protected.update(short for name in tuple(protected)
                             if len(short := re.sub(r'(?:股份有限公司|有限责任公司|有限公司)$', '', name)) >= 4)
        hard = [name for name in hard if name not in protected]
        soft = [name for name in soft if name not in protected]

        def _uniq(names: list[str]) -> list[str]:
            seen: set[str] = set()
            return [n for n in names if not (n in seen or seen.add(n))]
        lines = (text or '').splitlines()
        hard_hits = scan_residue(lines, _uniq(hard))
        soft_hits = scan_residue(lines, _uniq([n for n in soft if n not in set(_uniq(hard))]))
        if not hard_hits and (not soft_hits):
            total = len(_uniq(hard)) + len(_uniq(soft))
            return f'[残留扫描通过] 扫描 {total} 个旧名（硬 {len(_uniq(hard))}/疑似 {len(_uniq(soft))}），无残留。' if total else '[残留扫描通过] 扫描表为空——建议传 source_item_id 或 old_names。'
        parts: list[str] = []
        if hard_hits:
            parts.append(f'[旧名残留告警] 共 {len(hard_hits)} 个旧名残留，提交前必须全部替换：\n' + '\n'.join(hard_hits))
        if soft_hits:
            parts.append(f'[疑似残留提示] 共 {len(soft_hits)} 个词来自来源文件名（项目名常混通用术语），逐条核对：旧项目用语→替换；确认是通用术语→忽略并在汇报里说明一句：\n' + '\n'.join(soft_hits))
        return '\n'.join(parts)
    except Exception as e:
        return f'[残留扫描失败] {type(e).__name__}: {e}'

def re_split_name(stem: str) -> list[str]:
    import re
    return [p for p in re.split('[\\s（）()\\-_—【】\\[\\]]+', stem) if p]
