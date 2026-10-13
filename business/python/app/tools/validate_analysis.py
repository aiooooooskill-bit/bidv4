"""tender-analysis 产物机器校验工具（提示不是门禁：逐条给修复写法，不阻塞流程）。

校验契约（真值 = tender-analysis SKILL.md 输出约定 + 引用键纪律）：
- coverage：七节必有「## coverage 声明」段（structure 允许「四、」序号前缀），段内含
  「已检查：」与「未检查：」；disqualification 另必有「反查词表：」；clarifications
  不要求 coverage（它是汇总清单，用「## 状态」段）
- 出处列（节→列名）：structure / requirements-qualification / requirements-submission /
  disqualification / evaluation =「出处」；requirements-business =
  「出处（章/节/附件编号）」（第 2 列，assemble 的 REQ 登记表位置）；requirements-format =
  「原文出处线索」；clarifications 无出处列
- 引用键三层：①段首锚定——出处段以「同文件 」或来源文件名开头，「/」分隔段继承前段锚、
  「；」分隔段各自独立锚；②文件名 ∈ sources.json 已确认来源集合；③L 行号 ≤ 该来源
  解析 md 的总行数（引用无解析产物的文件=违规，降级文件不可引用）
"""
from __future__ import annotations
import json
import re
from .. import runctx
from ..artifact_store import work_dir
from ..markdown import iter_tables, sections
_SECTIONS = ('structure', 'requirements-qualification', 'requirements-submission', 'requirements-business', 'requirements-format', 'disqualification', 'evaluation', 'clarifications')
_NEED_COVERAGE = set(_SECTIONS) - {'clarifications'}
_CITATION_COLUMNS: dict[str, tuple[str, ...]] = {'structure': ('出处',), 'requirements-qualification': ('出处',), 'requirements-submission': ('出处',), 'requirements-business': ('出处（章/节/附件编号）', '出处'), 'requirements-format': ('原文出处线索',), 'disqualification': ('出处',), 'evaluation': ('出处',)}
_REQUIRED_HEADERS = {
    'structure': [('字段', '值', '状态', '出处')],
    'requirements-qualification': [('序号', '要求', '需证明材料', '不通过后果', '出处')],
    'requirements-submission': [('序号', '规则', '高风险', '后果', '出处')],
    'requirements-business': [('需求（原文 verbatim 片段）', '出处（章/节/附件编号）')],
    'requirements-format': [('序号', '章节名称', '归属(bidPart)', '原文出处线索'),
                            ('序号', '模板名称', '归属(bidPart)', '对应必须章节', '原文出处线索')],
    'disqualification': [('序号', '触发条件', '后果', '严重度', '出处')],
    'evaluation': [('评分项', '分值', '评分要点', '出处')],
    'clarifications': [('编号', '类型', '问题', '影响范围', '建议动作')],
}
_COVERAGE_RE = re.compile('^(?:[一二三四五]+、\\s*)?coverage\\s*声明\\s*$')
_FILENAME_LIKE = re.compile(r'^(?P<fn>.+?\.(?:docx|pdf|txt|md|png|jpe?g|gif|webp))(?=[\s（(]|$)', re.IGNORECASE)
_L_NUM = re.compile('L(\\d+)')

def _excerpt(cell: str, limit: int=40) -> str:
    return cell if len(cell) <= limit else cell[:limit - 1] + '…'

def _split_top(cell: str, seps: str, known: list[str]) -> list[str]:
    """实际来源文件名保持整名，其他位置只在括号深度 0 处分割。
    括号内「L52；后果见同文件 须知 20.1（L210）」是行文注释。
    """
    parts: list[str] = []
    buf: list[str] = []
    depth = 0
    names = _known_file_spans(cell, known)
    for index, ch in enumerate(cell):
        if any(start <= index < end for start, end, _ in names):
            buf.append(ch)
            continue
        if ch in '（([':
            depth += 1
        elif ch in '）)]':
            depth = max(0, depth - 1)
        if ch in seps and depth == 0:
            parts.append(''.join(buf))
            buf = []
        else:
            buf.append(ch)
    parts.append(''.join(buf))
    return parts

def _match_known_file(seg: str, known: list[str]) -> str | None:
    for fn in sorted(known, key=len, reverse=True):
        if seg == fn or seg.startswith(fn + ' ') or seg.startswith(fn + '（') or seg.startswith(fn + '('):
            return fn
    return None


def _known_file_spans(seg: str, known: list[str]) -> list[tuple[int, int, str]]:
    spans = []
    for name in sorted(set(known), key=len, reverse=True):
        if not name:
            continue
        for match in re.finditer(re.escape(name), seg):
            start, end = match.span()
            before, after = seg[start - 1:start] if start else '', seg[end:end + 1]
            if (before and re.match(r'[\w.-]', before)) or (after and re.match(r'[\w.-]', after)):
                continue
            if not any(start < old_end and end > old_start for old_start, old_end, _ in spans):
                spans.append((start, end, name))
    return sorted(spans)


_FILENAME_END = re.compile(r'\.[A-Za-z][A-Za-z0-9]{1,7}(?=\s|[（(，,；;、/]|$)')


def _citation_events(seg: str, known: list[str]):
    spans = _known_file_spans(seg, known)
    events = [(start, 'file', name) for start, _, name in spans]
    for pattern, kind in ((re.compile('同文件'), 'same'), (_FILENAME_END, 'unknown'), (_L_NUM, 'line')):
        for match in pattern.finditer(seg):
            if not any(start <= match.start() < end for start, end, _ in spans):
                events.append((match.start(), kind, int(match.group(1)) if kind == 'line' else None))
    return sorted(events), spans


def _citation_segment(seg: str, known: list[str], anchor: str | None, previous: str | None):
    events, spans = _citation_events(seg, known)
    pending = set()
    references = []
    ambiguous = False
    for _, kind, value in events:
        if kind == 'line':
            references.append((anchor, value))
            if anchor is None:
                previous = None
            pending.clear()
        else:
            next_source = value if kind == 'file' else previous if kind == 'same' else None
            pending.add(next_source)
            ambiguous |= len(pending - {None}) > 1
            anchor = next_source if len(pending) == 1 else None
            previous = anchor
    return references, anchor, previous, any(kind == 'unknown' for _, kind, _ in events), ambiguous, spans


def _expand_citation_cell(cell: str, known: list[str], table_anchor: dict) -> str:
    """登记表脱离原表前，按已确认来源和同表锚展开「同文件」及 / 继承。"""
    result = []
    for part in _split_top(cell.strip(), '；;', known):
        anchor = None
        for raw in _split_top(part, '/', known):
            seg = raw.strip()
            if not seg:
                continue
            previous = table_anchor['file']
            inherited = anchor
            _, anchor, previous, unknown, ambiguous, _ = _citation_segment(seg, known, anchor, previous)
            if unknown or ambiguous:
                anchor = None
                previous = None
            elif seg.startswith('同文件') and table_anchor['file']:
                seg = table_anchor['file'] + ' ' + seg[len('同文件'):].lstrip()
            elif not _match_known_file(seg, known) and inherited:
                seg = inherited + ' ' + seg
            table_anchor['file'] = previous
            result.append(seg)
    return '；'.join(result)


def _check_citation_cell(cell: str, known: list[str], src_lines: dict[str, int], table_anchor: dict) -> list[str]:
    """校验一个出处格（三层：锚定/文件名集合/行号上限），返回问题清单。"""
    issues: list[str] = []
    cell = cell.strip()
    if not cell:
        return ['出处列为空——每行证据都必须能独立定位到文件（「文件名 …（L…）」或「同文件 …（L…）」）']
    for part in _split_top(cell, '；;', known):
        anchor = None
        for raw in _split_top(part, '/', known):
            seg = raw.strip()
            if not seg:
                continue
            previous = table_anchor['file']
            inherited = anchor
            references, anchor, previous, unknown, ambiguous, spans = _citation_segment(seg, known, anchor, previous)
            if unknown:
                match = _FILENAME_LIKE.match(seg)
                label = f"的文件名「{match.group('fn')}」" if match else '包含未确认文件'
                issues.append(f"出处「{_excerpt(seg)}」{label}不在已确认来源集合（{'、'.join(known) or '空'}）——核对文件名拼写，不得引用未确认/编造的文件")
                anchor = None
                previous = None
            if ambiguous:
                issues.append(f'出处「{_excerpt(seg)}」包含多个来源文件，须把各文件与对应行号分开写明，不能共用一个行号锚')
                anchor = None
                previous = None
            if seg.startswith('同文件') and not table_anchor['file']:
                issues.append(f'出处「{_excerpt(seg)}」用了「同文件」但本表此前没有出现任何文件名锚——首个出处须写全文件名')
            elif not spans and not seg.startswith('同文件') and inherited is None and not unknown:
                issues.append(f'出处「{_excerpt(seg)}」缺文件名或「同文件」前缀——写全「文件名 章节（L…）」或「同文件 章节（L…）」')
            table_anchor['file'] = previous
            if not references:
                issues.append(f'出处「{_excerpt(seg)}」缺行号引用——每段须含 L行号（如 L97 / L18-L22）')
            for source, number in references:
                if not source:
                    if not (unknown or ambiguous or seg.startswith('同文件')):
                        issues.append(f'出处「{_excerpt(seg)}」缺文件名或「同文件」前缀——写全「文件名 章节（L…）」或「同文件 章节（L…）」')
                    continue
                limit = src_lines.get(source)
                if limit is None:
                    issues.append(f'出处「{_excerpt(seg)}」引用的「{source}」没有解析产物（解析失败降级的文件不可引用）')
                elif number > limit:
                    issues.append(f'出处「{_excerpt(seg)}」的行号 L{number}超出「{source}」解析结果总行数 {limit}——行号只能来自实际读取的区段')
    return issues

def validate_analysis() -> str:
    """机器校验当前任务 work/analysis/ 的要点产物（coverage 声明/出处引用键两层）。

    写完一节或几节后调用：[校验通过] 才算该节完成；[校验未通过] 会逐条给出
    「文件:行号 现状→修复写法」，按提示修复产物后重新运行。校验是纪律不是门禁，
    不阻塞流程——但收尾汇报前必须全部通过。只读、幂等。
    """
    try:
        ctx = runctx.current_run()
        task_id = ctx.task_id if ctx else None
        if not task_id:
            return '[校验失败] 缺少任务上下文：要点产物在当前任务的 work/analysis/ 下'
        wroot = work_dir(task_id)
        adir = wroot / 'analysis'
        if not adir.is_dir():
            return '[校验失败] work/analysis/ 不存在——请先按 tender-analysis 技能产出要点文档'
        files = sorted(adir.glob('*.md'))
        if not files:
            return '[校验失败] work/analysis/ 下没有 .md 产物'
        known: list[str] = []
        src_lines: dict[str, int] = {}
        sources_note = ''
        sources_path = wroot / 'parse' / 'sources.json'
        if sources_path.is_file():
            try:
                data = json.loads(sources_path.read_text(encoding='utf-8'))
                known = [data.get('main') or ''] + [s.get('file', '') for s in data.get('supplements', [])]
                known = [f for f in known if f]
                for fn in known:
                    md = wroot / 'parse' / fn / f'{fn}.md'
                    if md.is_file():
                        src_lines[fn] = len(md.read_text(encoding='utf-8', errors='replace').splitlines())
            except (json.JSONDecodeError, ValueError):
                sources_note = 'sources.json 无法解析：文件名集合与行号上限校验已跳过'
        else:
            sources_note = 'sources.json 不存在：文件名集合与行号上限校验已跳过'
        issues: list[str] = []
        warnings: list[str] = []
        citations = 0
        stems: list[str] = []
        for p in files:
            stem = p.stem
            stems.append(stem)
            rel = p.name
            content = p.read_text(encoding='utf-8', errors='replace')
            tables = list(iter_tables(content))
            for required in _REQUIRED_HEADERS.get(stem, []):
                if not any(tuple(header) == required for _, header, _ in tables):
                    issues.append(f'{rel} 缺少合法的必需表格「{" | ".join(required)}」——表头须按模板列序且列不增不减，分隔行列数须一致；无条目也保留空表，不得用段落或代码块替代')
            if stem in _NEED_COVERAGE:
                cover = next((body for heading, body in sections(content, 2)
                              if _COVERAGE_RE.fullmatch(heading.title)), None)
                if cover is None:
                    issues.append(f'{rel} 缺「## coverage 声明」段——「未发现」只能对已检查范围成立，范围必须声明')
                else:
                    for kw in ('已检查：', '未检查：'):
                        if kw not in cover:
                            issues.append(f'{rel} 的 coverage 声明缺「{kw}」——两半都要写（未检查为无也写「未检查：无」）')
                    if stem == 'disqualification' and '反查词表：' not in cover:
                        issues.append(f'{rel} 的 coverage 声明缺「反查词表：」——废标节必须逐词列出反查词')
            col_names = _CITATION_COLUMNS.get(stem)
            if col_names:
                for _, header, body in tables:
                    col_idx = next((i for i, c in enumerate(header) if c in col_names), None)
                    if col_idx is None:
                        continue
                    table_anchor: dict = {'file': None}
                    for lineno, cells in body:
                        if col_idx >= len(cells):
                            continue
                        found = _check_citation_cell(cells[col_idx], known, src_lines, table_anchor)
                        if not found:
                            citations += 1
                        issues.extend((f'{rel}:{lineno} {msg}' for msg in found))
        if 'clarifications' not in stems and set(_NEED_COVERAGE) <= set(stems):
            warnings.append('clarifications.md 不存在——七节齐时应汇总待澄清清单')
        extras = [s for s in stems if s not in _SECTIONS]
        if extras:
            warnings.append('存在未识别文件（不在八件清单）：' + '、'.join(extras) + '——若是临时文件请移走，避免混入流水线')
        if sources_note:
            warnings.append(sources_note)
        if not issues:
            parts = [f'[校验通过] work/analysis/ 共 {len(files)} 件：coverage/出处引用（{citations} 条）全部合规']
            parts.extend((f'⚠️ {w}' for w in warnings))
            return '\n'.join(parts)
        parts = [f'[校验未通过] 共 {len(issues)} 处问题（按提示修复产物后重新运行 validate_analysis，全部通过才算完成）：']
        parts.extend((f'- {i}' for i in issues))
        parts.extend((f'⚠️ {w}' for w in warnings))
        return '\n'.join(parts)
    except Exception as e:
        return f'[校验失败] {type(e).__name__}: {e}'
