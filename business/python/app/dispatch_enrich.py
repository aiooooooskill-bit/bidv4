"""Prepare existing writer context and bind every requested directory section.

Business writing instructions are preserved. The native dispatch operation must
resolve all requested sections before admitting a writer; unknown or ambiguous
sections cannot silently fall through into an unbounded child task.
"""

from __future__ import annotations

import difflib
import json
import logging
import re
from datetime import date
from pathlib import Path
from typing import NamedTuple

from . import artifact_store, config, db
from .promises import promise_rows
from .tools import body_contract, docx_ops

# 注意：assemble_tender 在 tools/__init__ 里被同名 @tool 对象遮蔽，私有函数须走模块路径
from .tools.assemble_tender import _norm_id
from .tools.search_knowledge import _mt_image_count, _mt_ranges_str
from .tools.validate_body import _parse_guide_rows
from .services import build_state
from .services.errors import BusinessError

logger = logging.getLogger(__name__)

_ENRICH_MARK = "〔系统附"  # 幂等标记：含此标记的描述（重派/续跑再走一层）不再拼装
_MAX_SIBLINGS = 3  # 兄弟摘要上限（防派发随波数线性膨胀）
_SIBLING_HEAD_CHARS = 200
_WRAPPER_RE = re.compile(r"^(?:重写|续写|新写|撰写|补写|写)\s*")
_TAIL_RE = re.compile(r"(?:的)?(?:节|章节|小节|正文)$")

# 写作纪律内联（2026-09-12）：写手子代理 spec 无 skills 字段（deepagents 的
# SkillsMiddleware 只挂主代理），故每个写手开局都要 read_file 读一遍
# section-writing.md——实测全库该文件被读 215 次、其中 205 次在子代理，每次都是一个
# 完整往返 + 约 3.2K token 回灌。改为主代理派发时把这份方法论直接附进任务描述。
# 进程内缓存：文件内容部署期固定（改技能需重启），跨派发复用同一字符串
# （单 run 内字节稳定，遵守前缀缓存铁律）。
_SKILL_DOC = ("tender-body", "references/section-writing.md")
_skill_cache: str | None = None


def _skill_text() -> str | None:
    """写手方法论全文（section-writing.md）；不可用时返回 None（调用方跳过该段）。

    读失败只损失这一段内联，绝不影响其余拼装（与 _material_lines 等降级同款）。
    """
    global _skill_cache
    if _skill_cache is not None:
        return _skill_cache
    try:
        path = config.skills_source_dir().joinpath(*_SKILL_DOC)
        text = path.read_text(encoding="utf-8").strip()
        if not text:
            return None
        _skill_cache = text
        return text
    except Exception:
        logger.debug("写手方法论内联读取失败，跳过该段", exc_info=True)
        return None


def _needle(desc: str) -> str:
    """派发描述 → 节名探针：剥「重写/写」类前缀与「节」类后缀。"""
    s = _WRAPPER_RE.sub("", desc.strip())
    s = _TAIL_RE.sub("", s)
    return s.strip() or desc.strip()


def _match_leaf(needle: str, leaves: list[tuple[str, str, str]]) -> tuple[str, str, str] | None:
    """探针对账目录叶子：精确相等 > 包含 > 近似（缩写容忍，如「低代码产品方案」
    命中「低代码开发平台产品方案」），近似需显著唯一（头两名分差 ≥0.10）。

    返回 (册名, 标题, 交付形态)；0 命中或歧义返回 None——放行原文不猜。
    """
    scored: list[tuple[float, str, str, str]] = []
    for vol, title, delivery in leaves:
        st = body_contract.sanitize_name(title)
        if not needle:
            continue
        if needle == st:
            scored.append((2.0, vol, title, delivery))
        elif needle in st or st in needle:
            scored.append((1.0, vol, title, delivery))
        else:
            ratio = difflib.SequenceMatcher(None, needle, st).ratio()
            if ratio >= 0.55:
                scored.append((ratio, vol, title, delivery))
    if not scored:
        return None
    scored.sort(key=lambda x: x[0], reverse=True)
    if len(scored) > 1 and scored[0][0] - scored[1][0] < 0.10:
        return None  # 两个候选难分伯仲：多义，放行
    _, vol, title, delivery = scored[0]
    return vol, title, delivery


def _guide_row(
    task_id: str, content: dict, vol: str, title: str
) -> tuple[list[str], dict[str, int]] | None:
    """匹配叶子的指引行 (cells, 列名→下标)；无指引文件或无对应行返回 None。

    多册时指引「节」列按完整「原册名/标题」匹配，不猜斜杠的分隔位置。
    """
    p = artifact_store.work_dir(task_id) / body_contract.GUIDE_RELPATH
    try:
        guide_text = p.read_text(encoding="utf-8", errors="replace")
    except OSError:
        return None
    multi = body_contract.multi_volume(content)
    expected = f'{vol}/{title}' if multi else title
    for _lineno, cells, cols in _parse_guide_rows(guide_text):
        if cells[cols["节"]].strip() == expected:
            return cells, cols
    return None


def _requirement_lines(cells: list[str], cols: dict[str, int], registry: dict) -> tuple[list[str], bool]:
    """依据列 ID → 「要求原文+出处」行（编号解析后即弃）；返回 (行, 是否含格式件)。"""
    key = cols.get("依据")
    raw = cells[key].strip() if key is not None and key < len(cells) else ""
    ids = build_state.guide_reference_ids(raw)
    has_tpl = False
    for i in ids:
        e = registry.get(i)
        text = str((e or {}).get("text") or "").strip()
        if not text:
            raise BusinessError(422, f'指引依据 {i} 未关联到可信来源，请先核对写作指引')
        if str((e or {}).get("type") or "") == "模板":
            has_tpl = True
    def expand(match):
        entry = registry[_norm_id(match.group().upper())]
        source = str(entry.get('出处') or '').strip() or '—'
        details = '\n'.join(str(entry[k]) for k in ('评分要点', '原文依据') if entry.get(k))
        return f"{entry['text']}（出处：{source}）" + ('\n' + details if details else '')
    basis = build_state.GUIDE_REFERENCE_RE.sub(expand, raw)
    return ([f'- {basis}'] if basis and basis not in ('—', '-') else []), has_tpl


def _promise_lines(task_id: str) -> list[str]:
    """承诺清单「事项|值|说明」全部行（派发契约：承诺值必须随派发全量送达）。"""
    p = artifact_store.work_dir(task_id) / body_contract.PROMISE_RELPATH
    try:
        content = p.read_text(encoding="utf-8", errors="replace")
    except OSError:
        return []
    out: list[str] = []
    for row in promise_rows(content)[0]:
        if not row.item or not row.value:
            continue
        line = f"- {row.item}：{row.value}"
        if row.note and row.note != "—":
            line += f"（{row.note}）"
        out.append(line)
    return out


def _sibling_lines(
    task_id: str, content: dict, vols: list[str], own_titles: set[str]
) -> list[str]:
    """同册已写节的开头摘要（mtime 降序 ≤3 个，排除本任务全部节与整本合册）。

    多节任务（2026-09-15 模型自主拆分批）可能跨册：对涉及的册各取候选合并排序；
    排除集=本任务全部节名——同任务的节互见没必要（同一写手上下文里本来可见）。
    """
    multi = body_contract.multi_volume(content)
    own = {body_contract.sanitize_name(t) + ".docx" for t in own_titles}
    files: list[Path] = []
    for vol in dict.fromkeys(vols):
        # 册名存储键与正文、合册共用；不从显示册名自行拼文件夹。
        vdir = artifact_store.work_dir(task_id) / "body" / (
            body_contract.volume_key(vol) if multi else ""
        )
        if not vdir.is_dir():
            continue
        try:
            files.extend(
                f
                for f in vdir.glob("*.docx")
                if f.name not in own and not f.name.startswith(body_contract.VOLUME_PREFIX)
            )
        except OSError:
            continue
    try:
        files.sort(key=lambda f: f.stat().st_mtime, reverse=True)
    except OSError:
        return []
    out: list[str] = []
    for f in files[:_MAX_SIBLINGS]:
        try:
            head = docx_ops.head_text(f, _SIBLING_HEAD_CHARS)
        except Exception:
            continue  # 兄弟文件损坏：摘要缺一行不打断派发
        if head:
            out.append(f"- {f.stem}：{head}")
    return out


def _material_lines(mat: str) -> list[str] | None:
    """素材列 blk id → 逐块名片（标题/字数/含图/区间/来源文件/备注）。

    指引期检索的内容层复用：此前派发只传 id 字符串，写手不知块内是什么、
    被迫每节再 search_references 一遍（2026-09-10 收口——名片够列使用计划，
    全文走 docx_material_inject 注入后经读视图可见）。区间随名片下发——
    块是拷贝授权范围非注入原子，写手据此 read_file 精读后挑本节要用的
    行号区间（docx_material_inject 传 lines）。素材列无任何 blk id
    （【缺】/—）返回 None，调用方维持旧行；查不到的 id 以失效提示降级
    （写手自行检索）。来源文件名必须随行——改写后 check_name_residue 扫
    旧机构名的 old_names 取自它。
    """
    ids = [t for t in re.split(r"[、,，;；\s]+", mat) if t.startswith("blk_")]
    if not ids:
        return None
    files = {f["id"]: f for f in db.mt_list_files()}
    blocks_by_id = {b["id"]: b for b in db.mt_list_blocks()}
    out: list[str] = []
    for bid in ids:
        b = blocks_by_id.get(bid)
        if not b:
            out.append(f"- {bid}（已失效——请自行检索确认）")
            continue
        f = files.get(b.get("file_id"))
        src = f["file_name"] if f else "（来源文件已删除）"
        img = _mt_image_count(src, b.get("ranges")) if f else 0
        img_bit = f"，含图 {img} 处" if img else ""
        rng = _mt_ranges_str(b.get("ranges")) if f else ""
        rng_bit = f"｜区间：{rng}" if rng else ""
        line = (
            f"- 《{b['title']}》（约 {b.get('chars') or 0:,} 字{img_bit}）"
            f"{rng_bit}｜来源文件：{src}｜id：{bid}"
        )
        if b.get("note"):
            line += f"｜备注：{b['note']}"
        out.append(line)
    return out


_GAP_COL_KEYS = ("缺口", "备注")  # 指引缺口列表头名变体（契约名「缺口/备注」）
_BARE_ID_RE = re.compile(r"(?:MAND|TPL|REQ|SCORE)-\d+")

# 原件定位：标记与核心名提取（2026-09-10）。标记=附件N/附表N/表N（限 1-3 位
# 数字、后不接年月日防「报表2026年」误报）；核心名=剥标记与全部标点空白。
_LOC_MARK_RE = re.compile(r"(?:附件|附表|表)\s*(\d{1,3})(?![0-9年月日])")
_LOC_NOISE_RE = re.compile(r"[\s（）()【】\[\]：:、，,。．.；;！!？?\-—_/·]+")


def _core_name(s: str) -> tuple[str, tuple[str, ...]]:
    """标题 → (清洗核心名, 标记元组)：匹配比较用的稳定键。"""
    marks = tuple(re.sub(r"\s+", "", m.group(0)) for m in _LOC_MARK_RE.finditer(s))
    core = _LOC_NOISE_RE.sub("", _LOC_MARK_RE.sub("", s))
    return core, marks


def _source_location_line(task_id: str, leaf_title: str) -> str | None:
    """节名 → 「原件定位」行：在全部已解析来源的 outline.json 标题树里唯一定位
    该节对应的原件区段（2026-09-10）。

    动因：格式跟随/格式件节的写手此前要自己找「附件14」在哪——grep outline +
    读原文试探，实测最重节 71 轮里约 40 轮在找位置。匹配保守：标记（附件N/
    表N）双现且核心相容，或清洗核心名全等；跨全部文件唯一命中才带行，0 命中
    或歧义返回 None（宁可不带——定位错比不带更糟）。同文件内相邻（间距 ≤2 行）
    的命中合并区间（「表1：报价表」标题壳与正文条目两节点的常见形态）。
    """
    core_leaf, marks_leaf = _core_name(leaf_title)
    if not core_leaf and not marks_leaf:
        return None
    pdir = artifact_store.work_dir(task_id) / "parse"
    if not pdir.is_dir():
        return None
    hits: list[tuple[str, str, int, int]] = []  # (文件名, 条目标题, 起, 止)
    for outline_path in sorted(pdir.glob("*/*.outline.json")):
        try:
            tree = json.loads(outline_path.read_text(encoding="utf-8", errors="replace"))
        except (OSError, ValueError):
            continue
        fname = outline_path.name[: -len(".outline.json")]
        stack = list(tree) if isinstance(tree, list) else []
        while stack:
            n = stack.pop()
            if not isinstance(n, dict):
                continue
            title = str(n.get("标题") or "")
            s, e = n.get("start_line") or 0, n.get("end_line") or 0
            if title and isinstance(s, int) and isinstance(e, int) and s and e:
                core_e, marks_e = _core_name(title)
                shared = set(marks_leaf) & set(marks_e)
                if shared and (not core_leaf or not core_e or core_leaf in core_e or core_e in core_leaf):
                    hits.append((fname, title, s, e))
                elif core_leaf and core_e and core_leaf == core_e:
                    hits.append((fname, title, s, e))
            stack.extend(n.get("children") or [])
    if not hits:
        return None
    by_file: dict[str, list[tuple[str, int, int]]] = {}
    for fname, title, s, e in hits:
        by_file.setdefault(fname, []).append((title, s, e))
    spans: list[tuple[str, str, int, int]] = []
    for fname, items in by_file.items():
        items.sort(key=lambda x: x[1])
        first, cur_s, cur_e = items[0]
        for title, s, e in items[1:]:
            if s - cur_e <= 2:
                cur_e = max(cur_e, e)
            else:
                spans.append((fname, first, cur_s, cur_e))
                first, cur_s, cur_e = title, s, e
        spans.append((fname, first, cur_s, cur_e))
    if len(spans) != 1:
        return None  # 跨文件或同文件多处命中：歧义不带
    fname, title, s, e = spans[0]
    return (
        f"原件定位：{fname} L{s}-L{e}（{title}）——docx_source_inject 的 lines 参数"
        "直接用此区间；核对原文可按同区间 read_file 解析 md"
    )


def _gap_lines(cells: list[str], cols: dict[str, int]) -> str | None:
    """指引缺口列 → 「公司材料与缺口」段原文（整段透传，程序不解析格式）。

    缺口列由指引期知识库检索写入（【知识库】命中事实 + 【缺：…】未命中点名，
    见 guide-format.md）；这里只做机械透传。四类招标编号剥除（零编号派发契约：
    模型可能把依据列编号抄进缺口列，编号镜像进正文即泄漏）；CLAR 类澄清编号
    不剥——不是招标条款引用，写手需原样带回待办。
    """
    key = next((k for k in cols if any(x in k for x in _GAP_COL_KEYS)), None)
    if key is None:
        return None
    idx = cols[key]
    if idx >= len(cells):
        return None
    raw = cells[idx].strip()
    if not raw or raw in ("—", "无"):  # 「无」=中文指引常见占位，非内容
        return None
    text = _BARE_ID_RE.sub("", raw)
    text = re.sub(r"\s+", " ", text).strip()
    text = re.sub(r"[（(]\s*[、，;；]?\s*[）)]", "", text)  # 删编号后残留的空括号
    return text or None


class SectionTarget(NamedTuple):
    """节名对账命中的目录叶子目标（含规范输出路径）。"""

    vol: str
    title: str
    delivery: str
    rel: str  # 相对任务 work/ 的节文件路径，如 body/3.1 需求分析.docx
    content: dict  # 目录产物 content（多册判定等调用方自取）
    multi: bool


def _section_target(match, content):
    vol, title, delivery = match
    multi = body_contract.multi_volume(content)
    rel = f"body/{body_contract.volume_key(vol) + '/' if multi else ''}{body_contract.sanitize_name(title)}.docx"
    return SectionTarget(vol, title, delivery, rel, content, multi)


_MULTI_SEP_RE = re.compile(r"[、，,;；＋+&]")


def dispatch_targets(desc: str, task_id: str) -> list[SectionTarget]:
    """Bind the original dispatch to canonical directory leaves before activation."""
    first = _WRAPPER_RE.sub('', desc.strip().splitlines()[0]) if desc.strip() else ''
    if not first:
        return []
    _, content, _ = body_contract.load_directory(task_id)
    if not content:
        return []
    leaves = body_contract.body_nodes_for_task(task_id, content)
    titles = sorted({body_contract.sanitize_name(title) for _, title, _ in leaves}, key=len, reverse=True)
    targets = []
    while first:
        # Consume complete known titles before treating punctuation as a task
        # separator: e.g. 附件1、身份证明 or 数据范围、更新频率与质量保障.
        exact = None
        for title in titles:
            if first.startswith(title):
                rest = first[len(title):].lstrip()
                if not rest or _MULTI_SEP_RE.match(rest):
                    exact = title
                    break
        if exact:
            needle, first = exact, first[len(exact):]
        else:
            match = _MULTI_SEP_RE.search(first)
            needle, first = (first[:match.start()], first[match.start():]) if match else (first, '')
        match = _match_leaf(_needle(needle), leaves)
        if match is None:
            return []
        target = _section_target(match, content)
        if target.rel not in {t.rel for t in targets}:
            targets.append(target)
        first = _MULTI_SEP_RE.sub('', first.lstrip(), count=1).strip()
    return targets


def body_dispatch(desc: str, task_id: str) -> dict:
    targets = dispatch_targets(desc, task_id)
    if not targets:
        raise BusinessError(422, '正文任务首行须明确列出本次目录中的节名；存在未知或多义章节，尚未启动写手')
    enriched = build_enriched_description(desc, task_id)
    if enriched is None:
        raise BusinessError(422, '正文派发上下文未生成，尚未启动写手；请核对本次指引及节名')
    return {'description': enriched, 'section_paths': [t.rel for t in targets]}


def _section_context_lines(task_id: str, target: SectionTarget, revision: bool) -> tuple[str, list[str]]:
    """单节逐节块 → (输出路径行, 其余行：模式/图示/要求/原件定位/素材/缺口)。

    单节与多节拼装共用（2026-09-15 模型自主拆分批）——逐节事实推导只存在这一份。
    """
    vol, title, delivery, rel, content = (
        target.vol, target.title, target.delivery, target.rel, target.content,
    )
    lines: list[str] = []
    req_lines: list[str] = []
    has_tpl = False
    mode = ""
    mat = ""
    fig = ""
    gap = None
    loc = None
    guide = _guide_row(task_id, content, vol, title)
    if guide is not None:
        cells, cols = guide
        req_lines, has_tpl = _requirement_lines(cells, cols, build_state.guide_registry(task_id) or {})
        mode = cells[cols["模式"]].strip() if "模式" in cols else ""
        if "素材" in cols and cols["素材"] < len(cells):
            mat = cells[cols["素材"]].strip()
        # 图示列（2026-09-14 表格通道批）：计划先行——写手按清单逐项产出，
        # validate_body 节级对账；旧指引无此列=空串零影响
        fig = cells[cols["图示"]].strip() if "图示" in cols and cols["图示"] < len(cells) else ""
        gap = _gap_lines(cells, cols)
    try:
        loc = _source_location_line(task_id, title)
    except Exception:
        logger.debug("派发拼装：原件定位解析失败，跳过该行", exc_info=True)

    if mode and mode != "—":
        lines.append(f"既有写作模式（仅供核对，不构成本轮生成要求）：{mode}" if revision else f"写作模式：{mode}")
    elif delivery:
        lines.append(f"交付形态：{delivery}（指引无对应行，按目录节点形态处理）")
    # 图示项过滤与 validate_body 对账侧同款口径（[、;；,，] 切分、丢空与
    # 「—」项）：混合记法「表:对比、—」不把「—」当计划项透传
    fig_items = [x.strip() for x in re.split(r"[、;；,，]", fig) if x.strip() and x.strip() != "—"] if fig else []
    if fig_items:
        lines.append('既有图示规划（仅供核对与汇报，不构成本轮新增图表授权）：' if revision else
                     '本节图示清单（指引计划，逐项产出，收尾对账——类型:主题；'
                     '表=建节 body 的 table 块、分层/辐射/甘特/流程=docx_diagram_insert'
                     '（流程 kind=flow）、原型=docx_html_figure（内联样式 HTML））：')
        lines.append("、".join(fig_items))
    if req_lines:
        lines.append("要求清单（正文呼应要求本身或招标文件真实章节条款号）：")
        lines.extend(req_lines)
        if has_tpl and not revision:
            lines.append(
                "本节含格式件：从 sources/ 招标原件拷贝（docx_source_inject；"
                "pdf 原件无可拷元素，按解析文本自行成形）。"
            )
    if loc:
        lines.append(loc)
    if mat and mat != "—":
        try:
            mat_lines = _material_lines(mat)
        except Exception:
            logger.debug("派发拼装：素材块名片解析失败，降级 id 原文", exc_info=True)
            mat_lines = None
        if mat_lines:
            lines.append('既有素材来源（仅供核对，本轮不注入）：' if revision else
                         '可用素材块（拷贝授权范围：据此列使用计划，按需整块或挑块内区间注入，无需再检索）：')
            lines.extend(mat_lines)
        else:
            lines.append(f"可用素材块：{mat}")
    if gap:
        lines.append('公司材料与既有缺口（仅供核对及汇报；未被原始要求点名时不补写、不新增批注）：' if revision else
                     '公司材料与缺口（指引缺口列原文；【知识库】=知识库命中的公司事实，'
                     '证书数字照抄不得改写；【缺】=库里没有，加批注待办，禁止编造）：')
        lines.append(gap)
    return f"DOCX工具path：{rel}；validate_body.section：{rel}；文件工具路径：{artifact_store.work_dir(task_id).parent}/work/{rel}", lines


def build_enriched_description(desc: str, task_id: str) -> str | None:
    """瘦派发描述 → 补全派发说明；不适合拼装返回 None（调用方拒绝派发）。

    模型原话永远第一行（UI 子代理卡标题取首行）；其后是程序拼的上下文块。
    多节派发：首行列多个节名时共享块一份 + 逐节块每节一份；全部节名必须
    成功绑定，不能静默忽略未知节名。描述长度不改变当前阶段与输出路径契约。
    """
    try:
        if not isinstance(desc, str) or not desc.strip() or _ENRICH_MARK in desc:
            return None
        guide_path = artifact_store.work_dir(task_id) / body_contract.GUIDE_RELPATH
        issues = build_state.guide_reference_issues(task_id, guide_path.read_text()) if guide_path.is_file() else []
        if issues:
            raise BusinessError(422, '；'.join(issues))
        targets = dispatch_targets(desc, task_id)
        if not targets:
            return None
        execution = config.data_dir() / 'actions' / task_id / 'latest.json'
        action = json.loads(execution.read_text()) if execution.is_file() else {}
        revision = action.get('kind') == 'revise'
        read_only = action.get('read_only') is True
        start = '仅按原始要求读取指定现稿位置并逐节validate_body，完成后返回摘要' if read_only else '先docx_section_read读取现稿，按指定范围定向修订' if revision else '直接从建节开工'
        chain = '按原始要求指定位置读取现稿→' if read_only else '读取现稿→按原始要求定向处理→' if revision else '建节→注入→改写→'
        if len(targets) == 1:
            # 单节：提供一份共享上下文与本节的两类输出路径
            path_line, ctx_lines = _section_context_lines(task_id, targets[0], revision)
            out = [
                desc.strip(),
                f"{_ENRICH_MARK}：本节派发上下文（程序自动生成，直接使用；"
                "无需再读 写作指引/关键事实与承诺，也无需 check_pipeline_state）。"
                "开工纪律：当前任务绝对路径、输出路径、要求原文与出处、承诺值、素材名片"
                "**全部已在下方**——开局禁止 ls/glob 探测目录，禁止检索或使用 "
                "REQ/MAND/SCORE/TPL 内部编号（要求已按原文解析给出，编号不在你的语境），"
                + start,
                f"当前任务绝对路径：{artifact_store.work_dir(task_id).parent}",
                path_line,
                # 天级日期（写手子代理不继承任务上下文块拿不到日期，模型自编日期
                # 不可信——封面/投标函等落款用这行；单日内字节稳定，前缀缓存无伤）
                f"今天日期：{date.today().isoformat()}",
                *ctx_lines,
            ]
        else:
            out = [
                desc.strip(),
                f"{_ENRICH_MARK}：本任务派发上下文（程序自动生成，直接使用；本任务"
                f"共 {len(targets)} 节，**逐节完成**——每节独立走 {chain}"
                "validate_body 自查，全部节完成才收尾；无需再读 写作指引/关键事实"
                "与承诺，也无需 check_pipeline_state）。开工纪律：当前任务绝对路径、各节"
                "输出路径、要求原文与出处、承诺值、素材名片**全部已在下方**——开局"
                "禁止 ls/glob 探测目录，禁止检索或使用 REQ/MAND/SCORE/TPL 内部编号"
                "（要求已按原文解析给出，编号不在你的语境），直接从第一节开工",
                f"当前任务绝对路径：{artifact_store.work_dir(task_id).parent}",
                f"今天日期：{date.today().isoformat()}",
            ]
            for i, t in enumerate(targets, 1):
                path_line, ctx_lines = _section_context_lines(task_id, t, revision)
                out.append(f"【第 {i} 节：{t.title}】")
                out.append(path_line)
                out.extend(ctx_lines)
        promises = _promise_lines(task_id)
        out.append("承诺清单全部值（承诺类数字只能用这里）：")
        out.extend(
            promises
            or ["（清单文件缺失或为空——本轮仅在摘要记录，不补写或新增批注）" if revision else "（清单文件缺失或为空——缺项一律用 docx_comment_add 加批注（锚定相关段落）带回，不得编造）"]
        )
        sibs = _sibling_lines(
            task_id, targets[0].content, [t.vol for t in targets], {t.title for t in targets}
        )
        if sibs:
            out.append("兄弟节开头摘要（避免重复展开）：")
            out.extend(sibs)
        parsed = sorted(p.resolve() for p in (artifact_store.work_dir(task_id) / 'parse').glob('*/*.md') if p.is_file())
        if parsed:
            out.append('本任务实际解析稿路径（read直接使用，不要从来源名推测解析文件名；按上述出处行号局部读取）：')
            out.extend(str(p) for p in parsed)
        if action.get('instruction'):
            out.extend(['本轮页面原始要求（不能因派发摘要省略而丢失；仅在当前已分配章节内执行，主线程事项不由写手重复；后续用户明确修正优先）：', action['instruction']])
        if read_only:
            out.append('当前阶段：只读。仅完成本轮原始要求明确指定的读取、核验及逐节validate_body；现有规划、素材、主体快照、承诺与待办不扩大任务范围。不自动转为业务实质审查或追加取证，不修订、不插图、不新增批注。完成已分配范围后汇报真实操作、工具结果和仍有的待办，直接返回主线程。')
            return '\n'.join(out)
        if revision:
            out.append('当前阶段：局部修订。先docx_section_read读取现稿；只修改本轮要求涉及的片段，保留未被点名的方案、标题、表格、时间单位和图片。删除未确认承诺时，改写该片段使句意完整，不得为规避校验清空整段方案。仅用户明确要求删除整段时使用delete；不创建、不注入、不重建，不把已有正文改成精简新稿。失败按工具返回的真实视图恢复，先核对原文是否已被替换，不猜段号。逐节validate_body并汇报全部待办，不把批注或规划缺口变成本轮新增任务。')
            return '\n'.join(out)
        # 写作方法论内联：写手子代理没有 SkillsMiddleware，此前每节都要自己
        # read_file 读一遍（205 次实测）；这段已在任务描述里，开局不必再读。
        skill = _skill_text()
        if skill:
            out.append(
                "写作纪律（完整方法论已在下方给出——**不要再 read_file "
                "section-writing.md**，直接照此执行）："
            )
            out.append(skill)
        return "\n".join(out)
    except BusinessError:
        raise
    except Exception:
        logger.debug("派发说明拼装失败，拒绝派发（task=%s）", task_id, exc_info=True)
        return None
