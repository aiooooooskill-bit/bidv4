"""LingYan analysis contracts and original read-only checks, composed for review."""
import json
import re
from datetime import datetime
from pathlib import Path
from .. import artifact_store
from ..markdown import iter_tables, sections
from . import page_flow

SOURCE_COMMIT = 'de909f12572b4c469864b12255e26cc185ada7ec'
LABELS = dict(zip(('structure', 'requirements-qualification', 'requirements-submission', 'requirements-business', 'requirements-format', 'disqualification', 'evaluation', 'clarifications'), ('结构事实', '资格要求', '递交要求', '商务技术要求', '格式要求', '废标条款', '评分标准', '待澄清清单')))
# These standard structure-template fields impose no bid-document response duty.
INFORMATION_FIELDS = frozenset(('代理机构', '招标方式', '开标时间', '开标地点', '澄清截止', '文件获取截止'))

def information_only(row):
    return row['category'] == '结构事实' and row['text'].split('；', 1)[0].removeprefix('字段：') in INFORMATION_FIELDS

_SECTIONS = tuple(LABELS)
CATEGORIES = tuple(LABELS[k] for k in _SECTIONS if k != 'clarifications')

def method_version():
    root = Path(__file__).parents[1] / 'skills'
    paths = [root / 'tender-review/SKILL.md', root / '_shared/evidence-rules.md',
             root / '_shared/response-guidelines.md', root / 'document-parse/SKILL.md',
             root / 'tender-analysis/SKILL.md', *sorted((root / 'tender-analysis/references').glob('*.md'))]
    hashes = {str(p.relative_to(root)): page_flow.file_hash(p) for p in paths}
    hashes.update({p.name: page_flow.file_hash(p) for p in [Path(__file__), Path(__file__).with_name('review.py'), Path(__file__).with_name('review_batches.py'), Path(__file__).with_name('review_schema.py')]})
    return page_flow.digest(hashes)

def analysis_directory(tid, docs):
    from ..tools.validate_analysis import validate_analysis_files
    root = artifact_store.work_dir(tid)
    original = root / 'analysis'
    known = {d['name']: d['lines'] for d in docs if d['kind'] == 'tender'}
    reusable = platform_analysis_current(tid, docs)
    if reusable and validate_analysis_files(original, list(known), known).startswith('[校验通过]'):
        return original, True
    return root / 'review/analysis', False

def platform_analysis_current(tid, docs):
    from ..config import data_dir
    records = [json.loads(p.read_text()) for p in (data_dir() / 'actions' / tid).glob('*.json') if p.name != 'latest.json']
    record = max((r for r in records if r['kind'] == 'analyse'), key=lambda r: r['created_at'], default=None)
    if not record or record.get('analysis_sources') != page_flow.analysis_source_version(tid) or not record.get('analysis_progress') or any(p['done'] != p['total'] for p in record['analysis_progress']):
        return False
    root = artifact_store.work_dir(tid)
    files = [root / 'analysis' / (k + '.md') for k in _SECTIONS]
    if not all(p.is_file() for p in files):
        return False
    oldest = min(p.stat().st_mtime for p in files)
    for d in docs:
        if d['kind'] != 'tender': continue
        folder = root / 'parse' / d['name']
        md, meta = folder / (d['name'] + '.md'), folder / (d['name'] + '.meta.json')
        if not md.is_file() or not meta.is_file(): return False
        try:
            info = json.loads(meta.read_text())
            generated = datetime.fromisoformat(info['generated_at'].replace('Z', '+00:00')).timestamp()
            sha = info['sha256']
        except (json.JSONDecodeError, KeyError, ValueError, TypeError, AttributeError):
            return False
        if sha != d['sha256'] or page_flow.file_hash(md) != page_flow.file_hash(Path(d['path'])):
            return False
        if generated > oldest:
            return False
    return True


def previous_flow(tid, mode):
    if mode == 'external':
        return {'mode': mode, 'note': '外部文件沿用本平台document-parse、tender-analysis和共享证据规则；同版有效招标要点直接复用，缺少时建立独立依据。不把已有制作记录推定为外部文件的制作过程证明。'}
    from . import build_state, bidder
    root = artifact_store.work_dir(tid)
    state = build_state.snapshot(tid)
    directory = page_flow.directory(tid)
    identity = bidder.status(tid)
    return {'mode': mode, 'directory': directory,
        'analysis_files': [{'key': k, 'path': str(root / 'analysis' / (k + '.md')),
                            'sha256': page_flow.file_hash(root / 'analysis' / (k + '.md'))}
                           for k in _SECTIONS if (root / 'analysis' / (k + '.md')).is_file()],
        'analysis_note': '前序解读即使未齐备也保留供人工修订及出处对账；通过本轮来源版本和原校验的要点才能作为当前要求。目录中的要点编号只作关联线索，不能替代当前原文。',
        'planning': [{'kind': k, 'status': state['build_preparation'][k],
                      'path': str(root / p), 'changes': state['build_preparation_changes'].get(k, []),
                      **({'registry': build_state.guide_registry(tid)} if k == 'guide' and state['build_preparation'][k] == 'ready' else {})}
                     for k, p in [('guide', 'body/写作指引.md'), ('promises', 'body/关键事实与承诺.md')]],
        'chapters': state['body_sections'], 'orphan_body_files': state['orphan_body_files'],
        'bidder': {'confirmed': identity['confirmed'], 'stale': identity['stale'],
                   'snapshot': identity['snapshot'] if identity['confirmed'] and not identity['stale'] else None}}


def analysis_context(tid, docs, mode):
    directory, reused = analysis_directory(tid, docs)
    directory.mkdir(parents=True, exist_ok=True)
    stale = []
    if not reused:
        stamp = directory / 'sources.json'
        source = page_flow.analysis_source_version(tid)
        saved = json.loads(stamp.read_text()) if stamp.is_file() else None
        if not saved or saved['source_version'] != source:
            saved = {'source_version': source, 'before': {k: (directory / (k + '.md')).stat().st_mtime_ns for k in _SECTIONS if (directory / (k + '.md')).is_file()}}
            from ..parse import write_atomic
            write_atomic(stamp, json.dumps(saved, ensure_ascii=False))
        stale = [k for k, mtime in saved['before'].items() if (directory / (k + '.md')).is_file() and (directory / (k + '.md')).stat().st_mtime_ns == mtime]
    return {'directory': str(directory), 'reused_platform_analysis': reused,
        'sections': [{'key': k, 'title': LABELS[k], 'path': str(directory / (k + '.md')),
                     'reference': f'skills/tender-analysis/references/{k}.md',
                     'exists': (directory / (k + '.md')).is_file() and k not in stale, 'stale': k in stale} for k in _SECTIONS],
        'tender_documents': [d for d in docs if d['kind'] == 'tender'], 'previous_flow': previous_flow(tid, mode)}

def analysis_catalog(tid, docs, mode):
    from ..tools.validate_analysis import _REQUIRED_HEADERS, _CITATION_COLUMNS, citation_ranges, validate_analysis_files
    directory, reused = analysis_directory(tid, docs)
    missing = [k for k in _SECTIONS if not (directory / (k + '.md')).is_file()]
    if missing:
        raise ValueError('招标要点未完成：' + '、'.join(LABELS[k] for k in missing))
    if not reused:
        stamp = directory / 'sources.json'
        saved = json.loads(stamp.read_text()) if stamp.is_file() else None
        if not saved or saved['source_version'] != page_flow.analysis_source_version(tid):
            raise ValueError('招标来源集合或版本已变化，请先读取本轮要点路径并按原技能重新提取')
        stale = [k for k, mtime in saved['before'].items() if (directory / (k + '.md')).stat().st_mtime_ns == mtime]
        if stale:
            raise ValueError('旧审查要点过期，须按本轮来源重新提取：' + '、'.join(LABELS[k] for k in stale))
        oldest = min((directory / (k + '.md')).stat().st_mtime for k in _SECTIONS)
        for d in docs:
            if d['kind'] != 'tender': continue
            meta = Path(d['path']).with_name(d['name'] + '.meta.json')
            generated = datetime.fromisoformat(json.loads(meta.read_text())['generated_at'].replace('Z', '+00:00')).timestamp()
            if generated > oldest:
                raise ValueError('招标文件已重新解析，旧审查要点过期，须按同套解读技能重新提取')
    by_name = {d['name']: d for d in docs if d['kind'] == 'tender'}
    result = validate_analysis_files(directory, list(by_name), {n: d['lines'] for n, d in by_name.items()})
    if not result.startswith('[校验通过]'):
        raise ValueError(result)
    catalog = []
    coverage = []
    clarifications = []
    for key in _SECTIONS:
        content = (directory / (key + '.md')).read_text()
        if key == 'clarifications':
            for _, header, rows in iter_tables(content):
                if tuple(header) in _REQUIRED_HEADERS[key]:
                    clarifications.extend('；'.join(f'{header[i]}：{v}' for i, v in enumerate(cells) if v) for _, cells in rows if any(c.strip() not in ('', '—', '-', '无', '无待澄清事项') for c in cells))
            continue
        cover = next((body for heading, body in sections(content, 2) if 'coverage' in heading.title), '')
        coverage.append({'category': LABELS[key], 'note': cover.strip()})
        for table, (_, header, rows) in enumerate(iter_tables(content)):
            if tuple(header) not in _REQUIRED_HEADERS[key]:
                continue
            col = next(i for i, name in enumerate(header) if name in _CITATION_COLUMNS[key])
            table_anchor = {'file': None}
            for line, cells in rows:
                if not any(c.strip(' —-') for c in cells):
                    continue
                evidence = [{'document_id': by_name[filename]['id'], 'start': start, 'end': end}
                            for filename, start, end in citation_ranges(cells[col], list(by_name), table_anchor)]
                if not evidence:
                    raise ValueError(f'{key}.md L{line}：要求没有可定位招标依据')
                text = '；'.join(f'{header[i]}：{v}' for i, v in enumerate(cells) if i != col and v)
                catalog.append({'id': f'{key}:{table}:{line}', 'category': LABELS[key], 'text': text, 'tender': evidence})
    if not catalog:
        raise ValueError('招标要点没有可核查要求，不得生成空审核报告')
    version = page_flow.digest({k: page_flow.file_hash(directory / (k + '.md')) for k in _SECTIONS})
    return {'catalog': catalog, 'coverage': coverage, 'analysis_version': version,
            'validation': result, 'reused_platform_analysis': reused, 'clarifications': clarifications, 'previous_flow': previous_flow(tid, mode)}

def original_checks(tid, inputs, mode):
    from ..tools.validate_body import body_global_checks, validate_docx_file, _parse_guide_rows
    from .build_state import sections as body_sections, snapshot as build_snapshot
    from ..tools.body_contract import multi_volume
    checks = []
    body_root = artifact_store.work_dir(tid) / 'body'
    plans = {}
    guide = body_root / '写作指引.md'
    state = build_snapshot(tid) if mode == 'platform' else None
    guide_current = bool(state and state['build_preparation']['guide'] == 'ready')
    if guide_current and guide.is_file():
        for _, cells, columns in _parse_guide_rows(guide.read_text()):
            col = columns.get('素材')
            if col is not None:
                plans[cells[columns['节']].strip()] = re.findall(r'blk_[0-9a-f]{12}(?::L\d+-L\d+(?:,L\d+-L\d+)*)?', cells[col])
    chapters = {artifact_store.work_dir(tid) / s['path']: s for s in body_sections(tid)} if mode == 'platform' else {}
    for item in inputs:
        if item['kind'] != 'bid':
            continue
        if item['file'].suffix.lower() != '.docx':
            checks.append({'name': item['name'] + ' · 正文格式检查', 'status': 'not_applicable',
                           'detail': '灵燕DOCX终稿检查不适用于该格式；由原文对照核查，不冒充格式检查通过。'})
            continue
        chapter = chapters.get(item['file'])
        plan = None
        if chapter:
            content = page_flow.directory(tid)['content']
            key = chapter['volume'] + '/' + chapter['title'] if multi_volume(content) else chapter['title']
            plan = plans.get(key)
        issues, warnings, notes = validate_docx_file(item['file'], plan, body_root if guide_current else None)
        details = issues + warnings + notes
        checks.append({'name': item['name'] + ' · 灵燕正文检查', 'status': 'warning' if issues or warnings or notes else 'passed',
                       'document_ids': [item['id']], 'issues': issues, 'warnings': warnings, 'notes': notes,
                       'detail': '\n'.join(details) or '终稿视角未发现占位、格式残字问题。'})
    if mode == 'platform':
        current = state['build_preparation']['promises'] == 'ready'
        result = body_global_checks(body_root, [item['file'] for item in inputs if item['kind'] == 'bid'], check_promises=current)
        checks.append({'name': '灵燕全局承诺比对与节间查重', 'status': 'warning' if result['warnings'] else 'completed',
                       'document_ids': [item['id'] for item in inputs if item['kind'] == 'bid'], 'issues': [],
                       'warnings': result['warnings'], 'notes': result['notes'],
                       'detail': '\n'.join([result['summary'], *result['warnings'], *result['notes']])})
    else:
        checks.append({'name': '灵燕制作过程检查', 'status': 'not_applicable',
            'detail': '外部文件没有平台写作指引、已确认承诺清单和素材使用计划，不能验证素材使用率或将不存在的承诺清单当作已比对。承诺、旧名及前后冲突由全文原文对照核查。'})
    return checks


def check_issues(checks):
    """Keep LingYan's terminal-view findings as suggestions, without inventing
    a tender obligation or a disqualification/scoring consequence."""
    findings = []
    for ci, check in enumerate(checks):
        for n, message in enumerate([*check.get('issues', []), *check.get('warnings', [])], 1):
            location = re.match(r'^(P\d+|T\d+R\d+)(?:：|〔)', message)
            fact, _, advice = message.partition('——')
            findings.append({'id': f'document-check:{ci}:{n}',
                'document_ids': check['document_ids'], 'location': location[1] if location else '',
                'risk_type': 'suggestion', 'title': fact, 'explanation': message,
                'suggestion': advice or '请按终稿检查提示核对并修改；实际后果以本项目招标条款为准。'})
    return findings
