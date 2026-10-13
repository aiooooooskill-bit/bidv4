"""Versioned tender/bid comparison using the existing document parser and dsh loop."""
import json
from datetime import datetime, timezone
from pathlib import Path
from typing import Literal
from pydantic import BaseModel, ConfigDict, Field
from .. import artifact_store, document, runctx
from ..parse import write_atomic
from . import page_flow
from .errors import BusinessError

CATEGORIES = ('废标条款', '资格要求', '格式与结构', '评分标准', '商务要求', '技术要求')

def _root(tid):
    return artifact_store.work_dir(tid) / 'review'

def selection(tid):
    path = _root(tid) / 'input.json'
    return json.loads(path.read_text()) if path.is_file() else {'mode': 'platform', 'bids': []}

def set_input(tid, bids):
    from .edit_guard import require_idle
    page_flow.require_task(tid)
    require_idle(tid)
    main = page_flow.source_selection(tid)['main']
    names = {p.name for p in artifact_store.sources_dir(tid).iterdir() if p.is_file() and not p.name.startswith('.')}
    if not isinstance(bids, list) or not bids or any(not isinstance(n, str) or n not in names or n == main for n in bids) or len(set(bids)) != len(bids):
        raise BusinessError(422, '请选择与招标文件不同的投标文件')
    value = {'mode': 'external', 'bids': bids}
    # Bid documents must never participate in tender interpretation.
    page_flow.set_sources(tid, main, [])
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
    from .build_state import sections
    root = artifact_store.work_dir(tid)
    selected = page_flow.source_selection(tid)
    config = selection(tid)
    names = [selected['main'], *[s['file'] for s in selected['supplements']], *config['bids']]
    sources = {n: page_flow.file_hash(artifact_store.sources_dir(tid) / n) if (artifact_store.sources_dir(tid) / n).is_file() else None for n in names if n}
    body = {s['path']: page_flow.file_hash(root / s['path']) if (root / s['path']).is_file() else None for s in sections(tid)} if config['mode'] == 'platform' else {}
    return page_flow.digest({'sources': sources, 'selection': selected, 'review_input': config, 'body': body, 'directory': page_flow.directory(tid) if config['mode'] == 'platform' else None, 'analysis': {p.name: page_flow.file_hash(p) for p in (root / 'analysis').glob('*.md')}})

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
        result.append({k: d[k] for k in ('id', 'name', 'kind', 'sha256')} | {'path': str(md), 'outline_path': str(d['parse_dir'] / (d['name'] + '.outline.json')), 'lines': len(md.read_text().splitlines())})
    return result

class StrictModel(BaseModel):
    model_config = ConfigDict(extra='forbid', str_strip_whitespace=True)

class Evidence(StrictModel):
    document_id: str
    start: int = Field(ge=1, strict=True)
    end: int = Field(ge=1, strict=True)

class Requirement(StrictModel):
    id: str = Field(min_length=1)
    category: Literal['废标条款', '资格要求', '格式与结构', '评分标准', '商务要求', '技术要求']
    text: str = Field(min_length=1)
    status: Literal['responded', 'missing', 'uncertain', 'conflict']
    tender: list[Evidence] = Field(min_length=1)
    bid: list[Evidence]

class Issue(StrictModel):
    id: str = Field(min_length=1)
    requirement_id: str
    severity: Literal['high', 'medium', 'low']
    title: str = Field(min_length=1)
    explanation: str = Field(min_length=1)
    suggestion: str = Field(min_length=1)

class Coverage(StrictModel):
    category: Literal['废标条款', '资格要求', '格式与结构', '评分标准', '商务要求', '技术要求']
    note: str = Field(min_length=1)

class Report(StrictModel):
    summary: str = Field(min_length=1)
    requirements: list[Requirement] = Field(min_length=1)
    issues: list[Issue]
    coverage: list[Coverage] = Field(min_length=6, max_length=6)
    limitations: list[str] = Field(min_length=1)

def compile_report(tid, value):
    report = Report.model_validate(value)
    docs = {d['id']: d for d in documents(tid)}
    ids = {r.id for r in report.requirements}
    if len(ids) != len(report.requirements) or len({i.id for i in report.issues}) != len(report.issues):
        raise ValueError('要求和问题编号必须唯一')
    if {c.category for c in report.coverage} != set(CATEGORIES):
        raise ValueError('必须说明六类要求的实际核查范围')
    evidence_errors = []
    for req in report.requirements:
        if req.status in ('responded', 'conflict') and not req.bid:
            evidence_errors.append(f'{req.id}：已响应或存在冲突的要求必须提供投标原文证据')
        for kind, evidence in [('tender', req.tender), ('bid', req.bid)]:
            for e in evidence:
                d = docs.get(e.document_id)
                if not d or d['kind'] != kind or e.end < e.start or e.end > d['lines']:
                    evidence_errors.append(f'{req.id}.{kind}：证据角色或行号无效（{e.document_id} L{e.start}-{e.end}）')
                    continue
    if evidence_errors:
        raise ValueError('证据校验未通过，共' + str(len(evidence_errors)) + '处。请核对document_id、文件角色和起止行号。\n' + '\n'.join(evidence_errors))
    for issue in report.issues:
        if issue.requirement_id not in ids:
            raise ValueError('问题必须关联已核查要求')
    for req in report.requirements:
        if req.status in ('missing', 'conflict') and not any(i.requirement_id == req.id for i in report.issues):
            raise ValueError(f'{req.id}：缺失或冲突的要求必须进入问题清单；待外部核验事项应在范围限制中说明')
    compiled = report.model_dump()
    for req in compiled['requirements']:
        for kind in ('tender', 'bid'):
            for evidence in req[kind]:
                d = docs[evidence['document_id']]
                evidence['quote'] = '\n'.join(Path(d['path']).read_text().splitlines()[evidence['start'] - 1:evidence['end']])
    return compiled

def validate_saved_report(tid, value):
    # Stored evidence is program-produced; recheck it against the same immutable sources.
    refs = json.loads(json.dumps(value))
    quotes = []
    for req in refs['requirements']:
        for kind in ('tender', 'bid'):
            for evidence in req[kind]:
                quotes.append(evidence.pop('quote'))
    compiled = compile_report(tid, refs)
    actual = [e['quote'] for r in compiled['requirements'] for kind in ('tender', 'bid') for e in r[kind]]
    if quotes != actual:
        raise ValueError('已保存证据与原文不一致，请重新审核')
    return compiled

def _record(tid):
    from ..config import data_dir
    paths = data_dir() / 'actions' / tid
    records = [json.loads(p.read_text()) for p in paths.glob('*.json') if p.name != 'latest.json']
    return max((r for r in records if r['kind'] == 'review'), key=lambda r: r['created_at'], default=None)

def _report_path(tid, session):
    if not session or Path(session).name != session:
        raise ValueError('审查会话编号无效')
    return _root(tid) / 'runs' / (session + '.json')

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
    envelope = {'session_id': session, 'input_version': record['input_version'], 'completed': False, 'created_at': datetime.now(timezone.utc).isoformat(), 'documents': documents(tid), 'report': report, 'decisions': {}}
    write_atomic(_report_path(tid, session), json.dumps(envelope, ensure_ascii=False))
    return {'saved': True, 'requirements': len(report['requirements']), 'issues': len(report['issues'])}

def finish(tid, session):
    path = _report_path(tid, session)
    if not path.is_file():
        raise ValueError('本轮未生成有效审查报告')
    report = json.loads(path.read_text())
    if report['input_version'] != basis(tid):
        raise ValueError('审查文件版本已变化，请重新审核')
    validate_saved_report(tid, report['report'])
    report['completed'] = True
    write_atomic(path, json.dumps(report, ensure_ascii=False))
    return {'ok': True}

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
    return {'mode': config['mode'], 'bids': config['bids'], 'status': status, 'input_version': current, 'report': envelope if envelope and envelope['completed'] else None}

def decide(tid, session, issue_id, status, note):
    from .edit_guard import require_idle
    require_idle(tid)
    state = snapshot(tid)
    report = state['report']
    if state['status'] != 'reviewed' or not report or report['session_id'] != session:
        raise BusinessError(409, '当前报告已变化，请重新审核或读取最新报告')
    if status not in ('pending', 'confirmed', 'fixed', 'ignored') or not isinstance(note, str) or len(note) > 4000:
        raise BusinessError(422, '复核结论或备注无效')
    if not any(i['id'] == issue_id for i in report['report']['issues']):
        raise BusinessError(422, '问题不属于当前报告')
    report['decisions'][issue_id] = {'status': status, 'note': note, 'updated_at': datetime.now(timezone.utc).isoformat()}
    write_atomic(_report_path(tid, session), json.dumps(report, ensure_ascii=False))
    return {'ok': True}
