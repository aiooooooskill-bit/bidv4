"""确定性组装工具：把目录中间产物组装为投标目录 Artifact（tender.directory）。

registry 构建 / 目录树与标注解析 / lineage 核对回收自 tender-toc skill 的
parse_toc.py（build 路径）；输入位置为技能产物布局（work/analysis + work/outline），
产物经 publish 管线发布（单一当前版本，重跑覆盖前自动留恢复点）。

机器输入的格式契约（tender-analysis / tender-outline 的产物必须遵守）：
- work/analysis/requirements-format.md：`## 二、必须有的章节` 与 `## 三、模板` 两张表
  （MAND/TPL registry，行序=编号）
- work/analysis/requirements-business.md：`| 需求 | 出处 |` 表（REQ registry，行序=编号）
- work/analysis/evaluation.md：`| 评分项 | 分值 | 评分要点 | 出处 |` 表（SCORE registry）
- work/outline/tender-response-docs.md：`# 响应文件：X` + scope + `## 目录` /
  `## 来源标注` / `## 目录说明`（可选顶部 `## 项目信息`）
各 analysis 文件在登记表之后的可选段（待澄清登记/coverage 声明/评标办法概述）
不参与行序编号；目录段中不符合列表格式的行会被静默跳过（探测警告见返回文案）。
"""
from __future__ import annotations
import json
import re
from pydantic import ValidationError
from .. import publish, runctx
from ..artifact_store import work_dir
from ..config import workspace_dir
from . import body_contract
from ..markdown import headings, sections, iter_tables, list_items
from .validate_analysis import _expand_citation_cell
CONTRACT_KEY = 'tender.directory/tender-response-docs@1'
ID_RE = re.compile('^(MAND|REQ|SCORE|TPL)-\\d+$')
_OPTIONAL_SECTION_RE = re.compile('^(待澄清登记|coverage\\s*声明|评标办法概述)\\s*$')
DIR_NOTE_RE = re.compile('^(?P<title>.+?)\\s*::\\s*交付形态=(?P<mode>[^|]+?)\\s*\\|\\s*归位理由=(?P<reason>[^|]*?)\\s*\\|\\s*理由来源=(?P<rids>[^|]*?)\\s*\\|\\s*概述=(?P<summary>.*)$')

def _norm_id(i: str) -> str:
    """来源ID数字部分补零到两位（MAND-1 -> MAND-01），与 registry 键保持一致。"""
    return re.sub('(\\d+)$', lambda m: m.group(1).zfill(2), i)


def _cut_optional_sections(md: str) -> str:
    """登记表在可选汇总章节之前结束；代码示例中的标题不参与分段。"""
    end = next((h.line - 1 for h in headings(md)
                if h.level == 2 and _OPTIONAL_SECTION_RE.fullmatch(h.title)), None)
    return '\n'.join(md.splitlines()[:end]) if end is not None else md


def _split_format_sections(md: str, *, source: str) -> dict[str, str]:
    result = {'structure': '', 'mandatory': '', 'templates': ''}
    for heading, body in sections(md, 2, source=source):
        for prefix, key in (('一、', 'structure'), ('二、', 'mandatory'), ('三、', 'templates')):
            if heading.title.startswith(prefix):
                result[key] = body
    return result


def _build_mand_tpl_registry(fmt_md: str, source_names: list[str]) -> tuple[dict, dict]:
    sec = _split_format_sections(_cut_optional_sections(fmt_md), source=fmt_md)
    mand, tpl = {}, {}
    for _, header, rows in iter_tables(sec['mandatory'], source=fmt_md):
        if '章节名称' not in header:
            continue
        anchor = {'file': None}
        for _, cells in rows:
            mand[f'MAND-{len(mand) + 1:02d}'] = {
                'type': '招标文件规定', 'text': cells[header.index('章节名称')],
                '出处': _expand_citation_cell(cells[header.index('原文出处线索')], source_names, anchor) if '原文出处线索' in header else ''}
    for _, header, rows in iter_tables(sec['templates'], source=fmt_md):
        if '模板名称' not in header:
            continue
        anchor = {'file': None}
        for _, cells in rows:
            tpl[f'TPL-{len(tpl) + 1:02d}'] = {
                'type': '模板', 'text': cells[header.index('模板名称')],
                '出处': _expand_citation_cell(cells[header.index('原文出处线索')], source_names, anchor) if '原文出处线索' in header else ''}
    return mand, tpl


def _build_req_registry(biz_md: str, source_names: list[str]) -> dict:
    reg = {}
    for _, header, rows in iter_tables(_cut_optional_sections(biz_md), source=biz_md):
        if len(header) < 2 or not header[0].startswith(('需求', '要求')):
            continue
        anchor = {'file': None}
        for _, cells in rows:
            if cells[0]:
                reg[f'REQ-{len(reg) + 1:02d}'] = {'type': '需求', 'text': cells[0], '出处': _expand_citation_cell(cells[1], source_names, anchor)}
    return reg


def _build_score_registry(eval_md: str, source_names: list[str]) -> dict:
    reg = {}
    for _, header, rows in iter_tables(_cut_optional_sections(eval_md), source=eval_md):
        if not header or header[0] not in ('评分项', '评分标准'):
            continue
        anchor = {'file': None}
        for _, cells in rows:
            if cells[0]:
                reg[f'SCORE-{len(reg) + 1:02d}'] = {'type': '评分点', 'text': cells[0], '分值': cells[1] if len(cells) > 2 else '', '评分要点': cells[2] if len(cells) > 3 else '', '出处': _expand_citation_cell(cells[-1], source_names, anchor)}
    return reg


def _parse_trailer(md: str, *, source: str) -> dict[str, list[str]]:
    """来源标注的列表项文本按业务约定拆分 ID。"""
    result = {}
    for item in list_items(_extract_section(md, '来源标注'), source=source):
        if item.ordered or '::' not in item.text:
            continue
        title, _, ids = item.text.partition('::')
        title = title.strip()
        idlist = [_norm_id(x.strip()) for x in ids.split(',') if ID_RE.fullmatch(x.strip())]
        if title and idlist:
            result.setdefault(title, [])
            for rid in idlist:
                if rid not in result[title]:
                    result[title].append(rid)
    return result


def _parse_dir_notes(md: str, *, source: str) -> dict[str, dict]:
    """目录说明：成熟解析器读列表，业务字段保留现有格式契约。"""
    result = {}
    for item in list_items(_extract_section(md, '目录说明'), source=source):
        if item.ordered:
            continue
        m = DIR_NOTE_RE.fullmatch(item.text)
        if m and m.group('title').strip():
            rids = [_norm_id(x.strip()) for x in m.group('rids').split(',') if ID_RE.fullmatch(x.strip())]
            result[m.group('title').strip()] = {
                'delivery_mode': m.group('mode').strip(), 'placement_reason': m.group('reason').strip(),
                'reason_source_ids': rids, 'brief_summary': m.group('summary').strip()}
    return result


def _md_to_tree(md: str, *, source: str | None = None) -> list[dict]:
    """无序列表语法树 → 目录树；有序列表不符合目录业务契约。"""
    root = []
    stack = [(-1, root)]
    for item in list_items(md, source=source):
        if item.ordered:
            continue
        node = {'目录名称': item.text, 'level': item.depth, 'children': []}
        while stack[-1][0] >= item.depth:
            stack.pop()
        stack[-1][1].append(node)
        stack.append((item.depth, node['children']))
    _assign_levels(root, 1)
    return root

def _assign_levels(nodes: list[dict], base: int) -> list[dict]:
    for n in nodes:
        n['level'] = base
        _assign_levels(n.get('children', []), base + 1)
    return nodes


def _tree_skipped_lines(dir_md: str) -> list[str]:
    """实际解析进目录的列表项之外的非空原文，供丢节点警告使用。"""
    used = {line for item in list_items(dir_md) if not item.ordered
            for line in range(item.line, item.end_line + 1)}
    return [text.strip() for line, text in enumerate(dir_md.splitlines(), 1)
            if text.strip() and line not in used]

def _source_type(rid: str) -> str:
    if rid.startswith('MAND'):
        return '招标文件规定'
    if rid.startswith('REQ'):
        return '需求'
    if rid.startswith('SCORE'):
        return '评分点'
    if rid.startswith('TPL'):
        return '模板'
    return '其他'

def _match_lineage(title: str, lineage_map: dict[str, list[str]]) -> tuple[list[str], str | None]:
    """返回（来源 ID 列表, 命中的标注标题）——标题用于孤儿标注探测。"""
    if title in lineage_map:
        return (lineage_map[title], title)
    for k, v in lineage_map.items():
        if k and (k in title or title in k):
            return (v, k)
    return ([], None)

def _attach_lineage(tree: list[dict], lineage_map: dict[str, list[str]], dir_notes: dict[str, dict] | None=None, consumed: set[str] | None=None) -> None:
    for node in tree:
        ids, key = _match_lineage(node['目录名称'], lineage_map)
        if key is not None and consumed is not None:
            consumed.add(key)
        node['来源'] = sorted({_source_type(i) for i in ids}) if ids else []
        node['来源位置'] = ids if ids else []
        if dir_notes:
            note = dir_notes.get(node['目录名称']) or {}
            if note and consumed is not None:
                consumed.add(node['目录名称'])
            node['交付形态'] = note.get('delivery_mode', '')
            node['归位理由'] = note.get('placement_reason', '')
            node['理由来源'] = note.get('reason_source_ids', [])
            node['节点概述'] = note.get('brief_summary', '')
        _attach_lineage(node['children'], lineage_map, dir_notes, consumed)

def _fold_lineage(tree: list[dict]) -> tuple[list[dict], int]:
    """唯一承载折叠：同一条来源 ID 在祖先-后代链上只留最深节点（post-order，deepest-wins）。

    目录是正文生成的写作计划、按节点血缘分配任务，父子重复挂载=同一要求两级各写
    一遍（重复成文）。确定性结构规范化（与 _md_to_tree 重赋 level 同类）：
    三层链只留最深、兄弟同深全保留（真实需求）、仅浅层无更深保留；只动
    来源位置/来源，不碰目录说明的自辩字段。浅拷贝节点、不改入参（幂等）。

    Returns: (折叠后的新树, 移除总数)
    """
    removed_total = 0

    def _fold(nodes: list[dict]) -> tuple[list[dict], set[str]]:
        nonlocal removed_total
        out: list[dict] = []
        carried: set[str] = set()
        for node in nodes:
            children, child_carried = _fold(node.get('children') or [])
            own = set(node.get('来源位置') or [])
            overlap = own & child_carried
            if overlap:
                removed_total += len(overlap)
            kept = sorted(own - overlap)
            new_node = dict(node)
            new_node['children'] = children
            new_node['来源位置'] = kept
            new_node['来源'] = sorted({_source_type(i) for i in kept})
            out.append(new_node)
            carried |= child_carried | set(kept)
        return (out, carried)
    folded, _ = _fold(tree)
    return (folded, removed_total)


def _extract_section(body: str, name: str) -> str:
    return next((text for heading, text in sections(body, 2) if heading.title == name), '')


def _before_section(body: str, name: str) -> str:
    end = next((h.line - 1 for h in headings(body) if h.level == 2 and h.title == name), None)
    return '\n'.join(body.splitlines()[:end])

def _parse_response_docs(md: str, warnings: list[str] | None=None) -> list[dict]:
    """每个顶层 `# 响应文件：XXX` 为一个响应文件，内含 ## 目录/## 来源标注/## 目录说明。

    warnings 传入列表时，收集两类探测结果（不拦停发布）：
    树格式违反被跳过的行、没挂到任何目录节点的孤儿标注。
    """
    docs = []
    for heading, body in sections(md, 1):
        if not re.match(r'^响应文件[：:]', heading.title):
            continue
        name = re.sub(r'^响应文件[：:]\s*', '', heading.title).strip()
        dir_sec = _extract_section(body, '目录')
        lineage = _parse_trailer(body, source=md)
        notes = _parse_dir_notes(body, source=md)
        tree = _md_to_tree(dir_sec, source=md) if dir_sec.strip() else []
        consumed: set[str] = set()
        _attach_lineage(tree, lineage, notes, consumed)
        if warnings is not None:
            skipped = _tree_skipped_lines(dir_sec)
            if skipped:
                warnings.append(f'响应文件「{name}」目录树中有不符合 `- ` 列表格式的行（已被跳过=丢节点）：' + '；'.join(skipped) + '；建议修复后重新组装')
            orphan = [k for k in {*lineage, *notes} if k not in consumed]
            if orphan:
                warnings.append(f'响应文件「{name}」的来源标注/目录说明未挂到任何目录节点（标题与目录树对不上，或对应树行被跳过）：' + '；'.join(orphan) + '；建议修复后重新组装')
        scope = _before_section(body, '目录').strip()
        for prefix in ('scope：', 'scope:', 'Scope：'):
            if scope.startswith(prefix):
                scope = scope[len(prefix):].strip()
                break
        docs.append({'name': name, 'scope': scope, 'directory': tree})
    return docs


def _parse_meta(md: str) -> dict[str, str]:
    """项目信息按列表或标准 Markdown 表格读取。"""
    meta = {}
    content = _extract_section(md, '项目信息')
    for item in list_items(content, source=md):
        if item.ordered:
            continue
        m = re.fullmatch(r'(.+?)[：:]\s*(.+)', item.text)
        if m:
            meta[m.group(1).strip()] = m.group(2).strip()
    for _, header, rows in iter_tables(content, source=md):
        if len(header) != 2:
            continue
        for _, cells in rows:
            if cells[0]:
                meta[cells[0]] = cells[1]
    return meta

def _iter_nodes(tree: list[dict]):
    for n in tree:
        yield n
        yield from _iter_nodes(n.get('children', []))

def assemble_tender() -> str:
    """组装投标目录并发布为 Artifact（tender.directory，任务内唯一当前版本）。

    读取当前任务 work/analysis/（requirements-format / requirements-business /
    evaluation 构建来源登记表 MAND/TPL/REQ/SCORE）与 work/outline/tender-response-docs.md
    （响应文件 + 目录树 + 来源标注 + 目录说明），做 lineage 完整性核对
    （unused/dangling）后发布。悬空 ID 会发布但给出警告，应修复后重新组装。
    """
    try:
        ctx = runctx.current_run()
        task_id = ctx.task_id if ctx else None
        if not task_id:
            return '[组装失败] 缺少任务上下文：组装输入与 JSON 副本都在当前任务的 work/ 目录下'
        out_root = work_dir(task_id)
        inputs = {'work/analysis/requirements-format.md': out_root / 'analysis' / 'requirements-format.md', 'work/analysis/requirements-business.md': out_root / 'analysis' / 'requirements-business.md', 'work/analysis/evaluation.md': out_root / 'analysis' / 'evaluation.md', 'work/outline/tender-response-docs.md': out_root / 'outline' / 'tender-response-docs.md'}
        missing = [k for k, p in inputs.items() if not p.is_file()]
        if missing:
            return '[组装失败] 缺少上游产物：\n  ' + '\n  '.join(missing) + '\n  请先由 tender-analysis / tender-outline 技能产出这些文件再组装。'
        fmt_md = inputs['work/analysis/requirements-format.md'].read_text(encoding='utf-8')
        biz_md = inputs['work/analysis/requirements-business.md'].read_text(encoding='utf-8')
        eval_md = inputs['work/analysis/evaluation.md'].read_text(encoding='utf-8')
        outline_md = inputs['work/outline/tender-response-docs.md'].read_text(encoding='utf-8')
        from ..services.page_flow import source_selection
        selection = source_selection(task_id)
        source_names = [name for name in [selection['main'], *(s['file'] for s in selection['supplements'])] if name]
        mand_reg, tpl_reg = _build_mand_tpl_registry(fmt_md, source_names)
        req_reg = _build_req_registry(biz_md, source_names)
        score_reg = _build_score_registry(eval_md, source_names)
        registry: dict = {}
        for d in (mand_reg, tpl_reg, req_reg, score_reg):
            registry.update(d)
        from ..services.outline_contract import enrich_registry
        enrich_registry(registry, out_root, source_names)
        outline_warnings: list[str] = []
        docs = _parse_response_docs(outline_md, outline_warnings)
        meta = _parse_meta(outline_md)
        fold_count = 0
        for d in docs:
            d['directory'], n = _fold_lineage(d['directory'])
            fold_count += n
        referenced: set[str] = set()
        for d in docs:
            for n in _iter_nodes(d['directory']):
                referenced.update(n.get('来源位置', []) or [])
        unused_ids = sorted((k for k in registry if k not in referenced))
        dangling_ids = sorted((i for i in referenced if i not in registry))
        warnings: list[str] = list(outline_warnings)
        if not docs or all((not d['directory'] for d in docs)):
            warnings.append('未解析出任何响应文件目录，请检查 work/outline/tender-response-docs.md 格式')
        content: dict = {'response_documents': docs, 'registry': registry, 'meta': meta, 'lineage_check': {'unused_ids': unused_ids, 'dangling_ids': dangling_ids}}
        _, prev_content, _ = body_contract.load_directory(task_id)
        if isinstance(prev_content, dict):
            content.update({k: prev_content[k] for k in ('numbering', 'page_target') if k in prev_content})
        options_path = out_root / 'outline/.generation-options.json'
        if options_path.is_file():
            options = json.loads(options_path.read_text())
            content['page_target'] = options['page_target']
            content['numbering'] = options['numbering']
        if warnings:
            content['warning'] = '\n'.join(warnings)
        total = sum((1 for d in docs for _ in _iter_nodes(d['directory'])))
        json_path = out_root / 'outline' / 'tender-response-docs.json'
        json_path.parent.mkdir(parents=True, exist_ok=True)
        json_path.write_text(json.dumps(content, ensure_ascii=False, indent=2), encoding='utf-8')
        manifest = publish.publish_artifact(CONTRACT_KEY, content, display_name=None, source={'skill': 'tender-outline', 'thread_id': ctx.conversation_id if ctx else None, 'run_id': ctx.run_id if ctx else None}, task_id=task_id, conversation_id=ctx.conversation_id if ctx else None)
        options_path.unlink(missing_ok=True)
        unchanged = bool(manifest.get('_unchanged'))
        head = f"[组装完成] 投标目录（{manifest['artifact_id']}）：" if unchanged else f"[组装发布成功] 投标目录（{manifest['artifact_id']}）："
        parts = [head + f'响应文件 {len(docs)} 个 / 目录节点 {total} 个 / 来源登记 MAND={len(mand_reg)} TPL={len(tpl_reg)} REQ={len(req_reg)} SCORE={len(score_reg)}']
        if fold_count:
            parts.append(f'已按最深承载折叠 {fold_count} 处父子重复血缘（父级无需重复标注子级已答要求）')
        parts.extend((f'⚠️ {w}' for w in warnings))
        tail = '目录内容与当前发布版本一致，未重复发布（任务内唯一，后续阶段经 read_artifact 消费）。' if unchanged else '已发布为投标目录成果（任务内唯一，后续阶段经 read_artifact 消费）。'
        parts.extend([f'JSON 副本：{out_root.relative_to(workspace_dir())}/outline/tender-response-docs.json', tail])
        if dangling_ids:
            parts.append(f'⚠️ 悬空来源ID（被引用但登记表不存在，多为清单行序漂移或编号拼写错误）：{dangling_ids}；建议修正后重新组装发布')
        if unused_ids:
            parts.append(f'⚠️ 未被任何目录节点引用的来源ID：{unused_ids}；逐条处置——能归位的修订目录后重新组装，确属无需对应章节的（如扣分项、后续轮次才出现的最终报价）必须在最终回复向用户点名列出并各给一句处置建议，不得只字不提')
        return '\n'.join(parts)
    except (publish.PublishError, ValidationError) as e:
        return f'[组装失败] 发布校验未通过：{e}'
    except Exception as e:
        return f'[组装失败] {type(e).__name__}: {e}'
