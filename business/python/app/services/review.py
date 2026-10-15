"""Versioned tender/bid comparison using the existing document parser and dsh loop."""
import json
from datetime import datetime, timezone
from pathlib import Path
from .. import artifact_store, document, runctx
from ..parse import write_atomic
from . import page_flow, review_method
from .errors import BusinessError
from .review_schema import Report

CATEGORIES = review_method.CATEGORIES

def _root(tid):
    return artifact_store.work_dir(tid) / 'review'

def selection(tid):
    path = _root(tid) / 'input.json'
    return json.loads(path.read_text()) if path.is_file() else {'mode': 'platform', 'bids': []}

def set_input(tid, bids):
    from .edit_guard import require_idle
    page_flow.require_task(tid)
    require_idle(tid)
    selected = page_flow.source_selection(tid)
    main = selected['main']
    names = {p.name for p in artifact_store.sources_dir(tid).iterdir() if p.is_file() and not p.name.startswith('.')}
    if not isinstance(bids, list) or not bids or any(not isinstance(n, str) or n not in names or n == main for n in bids) or len(set(bids)) != len(bids):
        raise BusinessError(422, '请选择与招标文件不同的投标文件')
    value = {'mode': 'external', 'bids': bids}
    # Bid documents must never participate in tender interpretation.
    page_flow.set_sources(tid, main, [s['file'] for s in selected['supplements'] if s['file'] not in bids])
    write_atomic(_root(tid) / 'input.json', json.dumps(value, ensure_ascii=False))
    return value

def inputs(tid):
    selected = page_flow.source_selection(tid)
    root = artifact_store.work_dir(tid)
    result = []
    for i, name in enumerate([selected['main'], *[s['file'] for s in selected['supplements']]]):
        if name:
            result.append({'id': 'tender-' + str(i), 'name': name, 'kind': 'tender', 'file': artifact_store.sources_dir(tid) / name})
    config = selection(tid)
    if config['mode'] == 'external':
        bids = [artifact_store.sources_dir(tid) / n for n in config['bids']]
    else:
        # Compare the current directory's chapters, never obsolete or duplicate assembled copies.
        from .build_state import sections
        bids = [root / s['path'] for s in sections(tid) if (root / s['path']).is_file()]
    for i, path in enumerate(bids):
        result.append({'id': 'bid-' + str(i), 'name': path.name, 'kind': 'bid', 'file': path})
    for item in result:
        if not item['file'].is_file():
            raise BusinessError(422, '审查文件不存在：' + item['name'])
        item['sha256'] = page_flow.file_hash(item['file'])
        item['parse_dir'] = _root(tid) / 'parse' / item['id']
    return result

def basis(tid):
    from .build_state import sections, read as build_state
    from .asset_usage import basis as asset_basis
    from .bidder import basis as bidder_basis
    root = artifact_store.work_dir(tid)
    selected = page_flow.source_selection(tid)
    config = selection(tid)
    names = [selected['main'], *[s['file'] for s in selected['supplements']], *config['bids']]
    sources = {n: page_flow.file_hash(artifact_store.sources_dir(tid) / n) if (artifact_store.sources_dir(tid) / n).is_file() else None for n in names if n}
    body = {s['path']: page_flow.file_hash(root / s['path']) if (root / s['path']).is_file() else None for s in sections(tid)} if config['mode'] == 'platform' else {}
    context = {'sources': sources, 'selection': selected, 'review_input': config, 'body': body,
               'directory': page_flow.directory(tid) if config['mode'] == 'platform' else None,
               'analysis': {p.name: page_flow.file_hash(p) for p in (root / 'analysis').glob('*.md')},
               'review_method': review_method.method_version()}
    if config['mode'] == 'platform':
        context.update(planning={p.name: page_flow.file_hash(p) for p in (root / 'body').glob('*.md')},
                       planning_state=build_state(tid), assets=asset_basis(tid, ['guide', 'promises', *body]),
                       bidder=bidder_basis(tid))
    return page_flow.digest(context)


def prepare(tid):
    docs = inputs(tid)
    if not any(d['kind'] == 'tender' for d in docs) or not any(d['kind'] == 'bid' for d in docs):
        raise BusinessError(422, '请先上传招标和投标文件，或完成平台标书正文制作')
    return [{'id': d['id'], 'prepared': document.prepare(d['file'], d['parse_dir'])} for d in docs]

def documents(tid):
    result = []
    for d in inputs(tid):
        md = d['parse_dir'] / (d['name'] + '.md')
        meta = d['parse_dir'] / (d['name'] + '.meta.json')
        if not md.is_file() or not meta.is_file() or json.loads(meta.read_text())['sha256'] != d['sha256']:
            raise BusinessError(422, '审查文件尚未完整解析：' + d['name'])
        with md.open() as stream:
            lines = sum(len(line.splitlines()) for line in stream)
        result.append({k: d[k] for k in ('id', 'name', 'kind', 'sha256')} | {'path': str(md), 'outline_path': str(d['parse_dir'] / (d['name'] + '.outline.json')), 'lines': lines})
    return result

def review_basis(tid, validate=False):
    docs = documents(tid)
    mode = selection(tid)['mode']
    if not validate:
        return review_method.analysis_context(tid, docs, mode)
    return review_method.analysis_catalog(tid, docs, mode)

def source_excerpt(path, start, end):
    from itertools import chain, islice
    with Path(path).open() as stream:
        lines = chain.from_iterable(line.splitlines() for line in stream)
        return '\n'.join(islice(lines, start - 1, end))


def resolve_evidence(docs, tender, bid, basis_tender):
    """Resolve explicit citations; preserve every catalog source without guessing context."""
    from .review_schema import Evidence
    result = {}
    covered = {}
    for kind, items in (('tender', tender), ('bid', bid)):
        result[kind] = []
        for item in items:
            e = Evidence.model_validate(item).model_dump()
            d = docs.get(e['document_id'])
            if not d or d['kind'] != kind or not 1 <= e['start'] <= e['end'] <= d['lines'] or e['end'] - e['start'] > 100:
                raise ValueError('证据角色或范围无效；单段引用不超过101行')
            if kind == 'tender':
                covered.setdefault(e['document_id'], set()).update(range(e['start'], e['end'] + 1))
            result[kind].append(e | {'quote': source_excerpt(d['path'], e['start'], e['end'])})
    for base in basis_tender:
        if not set(range(base['start'], base['end'] + 1)) <= covered.get(base['document_id'], set()):
            raise ValueError('招标引用必须保留完整要点依据；回查原文后可扩展或补充引用')
    return result


def compile_report(tid, value):
    report = Report.model_validate(value)
    docs = {d['id']: d for d in documents(tid)}
    basis = review_basis(tid, True)
    catalog = {r['id']: r for r in basis['catalog']}
    ids = [r.basis_id for r in report.requirements]
    if len(set(ids)) != len(ids) or set(ids) != set(catalog):
        raise ValueError('必须逐项核查已校验的招标要点，不能遗漏或增加要求。缺少：' + '、'.join(set(catalog) - set(ids)) + '；未知：' + '、'.join(set(ids) - set(catalog)))
    if len({i.id for i in report.issues}) != len(report.issues):
        raise ValueError('问题编号必须唯一')
    errors = []
    compiled = report.model_dump()
    for req in compiled['requirements']:
        key = req.pop('basis_id')
        cited = resolve_evidence(docs, req['tender'], req['bid'], catalog[key]['tender'])
        req.update(catalog[key])
        req.update(cited)
        if review_method.information_only(req) != (req['status'] == 'informational'):
            errors.append(key + '：背景信息与投标响应状态不一致')
        if req['status'] == 'informational' and (req['bid'] or any(i.requirement_id == key for i in report.issues)):
            errors.append(key + '：背景信息不得套用无关投标引用或问题')
        if req['status'] in ('responded', 'conflict') and not req['bid']:
            errors.append(key + '：已响应或冲突必须提供投标证据')
        if req['status'] in ('missing', 'conflict') and not any(i.requirement_id == key for i in report.issues):
            errors.append(key + '：缺失或冲突必须关联问题')
    for issue in report.issues:
        if issue.requirement_id not in catalog:
            errors.append('问题必须关联招标要点：' + issue.requirement_id)
    if errors:
        raise ValueError('\n'.join(errors))
    compiled['coverage'] = basis['coverage']
    checks = review_method.original_checks(tid, inputs(tid), selection(tid)['mode'])
    compiled['document_issues'] = review_method.check_issues(checks)
    compiled['check_notes'] = [{'name': c['name'], 'notes': c.get('notes', []) if 'notes' in c else [c['detail']]}
                               for c in checks if c.get('notes') or c['status'] == 'not_applicable']
    all_issues = compiled['issues'] + compiled['document_issues']
    labels = [('disqualification', '可能废标'), ('scoring', '评分失分风险'), ('confirmation', '需确认'), ('suggestion', '建议修改')]
    counts = '、'.join(f'{label} {sum(i["risk_type"] == key for i in all_issues)} 条' for key, label in labels)
    compiled['summary_items'] = [
        f'本轮已逐项核查 {len(compiled["requirements"])} 项招标要点，涵盖' + '、'.join(c['category'] for c in compiled['coverage']) + '。',
        f'本次形成 {len(all_issues)} 条审查意见：{counts}。' if all_issues else '本次已核查范围内未发现问题；未覆盖事项及待人工核验内容见下方说明。',
    ]
    return compiled

def validate_saved_report(tid, value):
    refs = {'issues': value['issues'], 'limitations': value['limitations'],
            'requirements': [{'basis_id': r['id'], 'status': r['status'],
                **{kind: [{k: e[k] for k in ('document_id', 'start', 'end')} for e in r[kind]] for kind in ('tender', 'bid')}} for r in value['requirements']]}
    compiled = compile_report(tid, refs)
    if compiled != value:
        raise ValueError('已保存报告与招标要点或原文不一致，请重新审核')
    return compiled

def _record(tid):
    from ..config import data_dir
    paths = data_dir() / 'actions' / tid
    records = [json.loads(p.read_text()) for p in paths.glob('*.json') if p.name != 'latest.json']
    return max((r for r in records if r['kind'] == 'review'), key=lambda r: r['created_at'], default=None)

def _report_path(tid, session):
    if not session or Path(session).name != session:
        raise ValueError('审查会话编号无效')
    return _root(tid) / 'runs' / (session + '-' + str(_record(tid)['created_at']) + '.json')

def save_report(tid, session, value):
    record = _record(tid)
    if not record or record['session_id'] != session or record.get('stopped_at') or record['input_version'] != basis(tid):
        raise BusinessError(409, '审查执行或文件版本已变化，报告未保存')
    report = compile_report(tid, value)
    if selection(tid)['mode'] == 'platform':
        from .build_state import sections
        missing = [s['title'] for s in sections(tid) if not (artifact_store.work_dir(tid) / s['path']).is_file()]
        if missing:
            report['limitations'].append('当前平台目录尚有未生成章节：' + '、'.join(missing) + '；本次只核查现有正文。')
    envelope = {'session_id': session, 'input_version': record['input_version'], 'completed': False, 'created_at': datetime.now(timezone.utc).isoformat(), 'documents': documents(tid), 'report': report, 'decisions': {}, 'method': {'name': '标书审查', 'source_commit': review_method.SOURCE_COMMIT, 'version': review_method.method_version()}, 'analysis': review_basis(tid, True), 'checks': review_method.original_checks(tid, inputs(tid), selection(tid)['mode'])}
    write_atomic(_report_path(tid, session), json.dumps(envelope, ensure_ascii=False))
    return {'saved': True, 'requirements': len(report['requirements']), 'issues': len(report['issues']) + len(report['document_issues'])}

def finish(tid, session):
    path = _report_path(tid, session)
    if not path.is_file():
        raise ValueError('本轮未生成有效审查报告')
    report = json.loads(path.read_text())
    if report['input_version'] != basis(tid):
        raise ValueError('审查文件版本已变化，请重新审核')
    from . import review_batches
    rows = review_batches.completed(tid, session)
    if report.get('audit') != review_batches.audit_view(rows, len(review_batches.read(tid, session)[0]['batches'])):
        raise ValueError('报告说明或原文限定与已保存批次不一致')
    expected_issues = [p | {'id': f'{r["id"]}:issue:{n + 1}', 'requirement_id': r['id']} for r in rows for n, p in enumerate(r['problems'])]
    if report['report']['issues'] != expected_issues:
        raise ValueError('报告问题与已保存批次不一致')
    def citations(rows):
        return [{'basis_id': r['id'], 'status': r['status'], **{kind: [{k: e[k] for k in ('document_id', 'start', 'end')} for e in r[kind]] for kind in ('tender', 'bid')}} for r in rows]
    expected, actual = citations(rows), citations(report['report']['requirements'])
    if actual != expected:
        raise ValueError('报告结论与已保存批次不一致')
    validate_saved_report(tid, report['report'])
    report['completed'] = True
    write_atomic(path, json.dumps(report, ensure_ascii=False))
    return {'ok': True}

def list_state(tid):
    if not _record(tid):
        return {'status': 'unreviewed', 'mode': selection(tid)['mode']}
    value = snapshot(tid)
    return {k: value[k] for k in ('status', 'mode')}

def snapshot(tid):
    config = selection(tid)
    current = basis(tid)
    record = _record(tid)
    envelope = None
    if record:
        path = _report_path(tid, record['session_id'])
        if path.is_file():
            envelope = json.loads(path.read_text())
    status = 'unreviewed'
    if record:
        status = 'running' if not record.get('finished_state') else record['finished_state']
        if record.get('stopped_at'): status = 'stopped'
        if record.get('finished_state') == 'completed':
            status = 'reviewed' if envelope and envelope['completed'] else 'failed'
        if status == 'reviewed' and envelope['input_version'] != current: status = 'stale'
    if envelope and envelope.get('method', {}).get('version') != review_method.method_version():
        envelope = None
    elif envelope and status == 'reviewed':
        adir = artifact_store.work_dir(tid) / ('analysis' if envelope['analysis']['reused_platform_analysis'] else 'review/analysis')
        version = page_flow.digest({k: page_flow.file_hash(adir / (k + '.md')) if (adir / (k + '.md')).is_file() else None for k in review_method.LABELS})
        if version != envelope['analysis']['analysis_version']: status = 'stale'
    return {'method': {'name': '标书审查', 'source_commit': review_method.SOURCE_COMMIT, 'version': review_method.method_version()}, 'mode': config['mode'], 'bids': config['bids'], 'status': status, 'input_version': current, 'report': envelope if envelope and envelope['completed'] else None}

def decide(tid, session, issue_id, status, note):
    from .edit_guard import require_idle
    require_idle(tid)
    state = snapshot(tid)
    report = state['report']
    if state['status'] != 'reviewed' or not report or report['session_id'] != session:
        raise BusinessError(409, '当前报告已变化，请重新审核或读取最新报告')
    if status not in ('pending', 'confirmed', 'fixed', 'ignored') or not isinstance(note, str) or len(note) > 4000:
        raise BusinessError(422, '处理状态或备注无效')
    if not any(i['id'] == issue_id for i in [*report['report']['issues'], *report['report']['document_issues']]):
        raise BusinessError(422, '问题不属于当前报告')
    report['decisions'][issue_id] = {'status': status, 'note': note, 'updated_at': datetime.now(timezone.utc).isoformat()}
    write_atomic(_report_path(tid, session), json.dumps(report, ensure_ascii=False))
    return {'ok': True}
