"""Small comparison batches editable by the same auditor before completion; problems belong to a single requirement."""
import json
import re
from pathlib import Path
from pydantic import Field
from .review_schema import StrictModel, Evidence, RiskType
from typing import Literal
from ..parse import write_atomic
from . import review, page_flow, review_method

class Problem(StrictModel):
    risk_type: RiskType
    title: str = Field(min_length=1)
    explanation: str = Field(min_length=1)
    suggestion: str = Field(min_length=1)

class Comparison(StrictModel):
    slot: int = Field(ge=1, strict=True)
    status: Literal['responded', 'missing', 'uncertain', 'conflict', 'informational']
    assessment: str = Field(min_length=1)
    tender: list[Evidence] = Field(min_length=1)
    bid: list[Evidence]
    problems: list[Problem]


def context(tid, session):
    record = review._record(tid)
    if not record or record['session_id'] != session or record.get('stopped_at') or record['input_version'] != review.basis(tid):
        raise ValueError('审查执行或原件已变化')
    analysis = review.review_basis(tid, True)
    stamp = page_flow.digest({'input': record['input_version'], 'analysis': analysis['analysis_version']})
    groups = []
    for category in review.CATEGORIES:
        rows = [r for r in analysis['catalog'] if r['category'] == category]
        groups.extend(rows[i:i + 8] for i in range(0, len(rows), 8))
    return stamp, groups


def path(tid, session):
    review._report_path(tid, session)  # Validate session basename.
    return review._root(tid) / 'comparisons' / (session + '.json')


def read(tid, session):
    stamp, groups = context(tid, session)
    p = path(tid, session)
    value = json.loads(p.read_text()) if p.is_file() else {'stamp': stamp, 'batches': []}
    if value['stamp'] != stamp:
        raise ValueError('要点或原件版本变化，须重新审查')
    return value, groups


def quote(tid, evidence):
    docs = {d['id']: d for d in review.documents(tid)}
    d = docs[evidence['document_id']]
    return evidence | {'quote': review.source_excerpt(d['path'], evidence['start'], evidence['end'])}


def next_batch(tid, session):
    value, groups = read(tid, session)
    n = len(value['batches'])
    if n == len(groups):
        return {'complete': True, 'accepted': sum(len(b['comparisons']) for b in value['batches']), 'total_batches': n}
    return {'batch_id': f'{value["stamp"]}:{n}', 'batch': n + 1, 'total_batches': len(groups),
            'accepted': sum(len(b['comparisons']) for b in value['batches']),
            'requirements': [r | {'slot': i + 1, 'response_duty': 'information_only' if review_method.information_only(r) else 'compare_bid', 'tender': [quote(tid, e) for e in r['tender']]} for i, r in enumerate(groups[n])]}


def check_text(text):
    if re.search(r'(?<![A-Za-z])L\s*\d+|第\s*\d+\s*[行页]|\bline\s*\d+', text, re.I):
        raise ValueError('说明中不得手写原文行号/页号，引用由证据卡自动生成')


def candidate(tid, session, batch_id, results):
    value, groups = read(tid, session)
    if review._record(tid).get('finished_state'):
        raise ValueError('本轮已结束，不能更正已完成报告')
    ids = [f'{value["stamp"]}:{i}' for i in range(min(len(value['batches']) + 1, len(groups)))]
    if batch_id not in ids:
        raise ValueError('只能提交当前批次或更正本轮已保存批次，不能跨版本或跳过批次')
    group = groups[ids.index(batch_id)]
    batch = {'requirements': [r | {'slot': i + 1, 'tender': [quote(tid, e) for e in r['tender']]} for i, r in enumerate(group)]}
    results = [Comparison.model_validate(r).model_dump() for r in results]
    if sorted(r['slot'] for r in results) != list(range(1, len(batch['requirements']) + 1)):
        raise ValueError('须逐项提交本批每个slot，不能重复或遗漏')
    results.sort(key=lambda r: r['slot'])
    docs = {d['id']: d for d in review.documents(tid)}
    compiled = []
    for req, result in zip(batch['requirements'], results):
        for text in [result['assessment'], *[v for p in result['problems'] for k, v in p.items() if k != 'risk_type']]:
            check_text(text)
        if review_method.information_only(req):
            if result['status'] != 'informational' or result['bid'] or result['problems']:
                raise ValueError(f'slot {result["slot"]}：招标背景信息无需投标响应，使用informational，不填写无关投标引用或问题')
        elif result['status'] == 'informational':
            raise ValueError('投标义务不能标为背景信息，应按实际响应/缺失/冲突/待确认判断')
        if result['status'] in ('responded', 'conflict') and not result['bid']:
            raise ValueError(f'slot {result["slot"]}：已响应/冲突须有投标原文证据')
        if result['status'] in ('missing', 'conflict') and not result['problems']:
            raise ValueError(f'slot {result["slot"]}：缺失/冲突须说明问题')
        cited = review.resolve_evidence(docs, result['tender'], result['bid'], req['tender'])
        compiled.append(req | result | cited)
    return {'batch_id': batch_id, 'comparisons': compiled}


def accept(tid, session, proposed):
    # Recompute from canonical catalog and source immediately before write.
    results = [{k: r[k] for k in ('slot', 'status', 'assessment', 'tender', 'bid', 'problems')} for r in proposed['comparisons']]
    for r in results:
        for kind in ('tender', 'bid'):
            r[kind] = [{k: e[k] for k in ('document_id', 'start', 'end')} for e in r[kind]]
    current = candidate(tid, session, proposed['batch_id'], results)
    if current != proposed:
        raise ValueError('保存期间引用或要点已变化')
    value, _ = read(tid, session)
    saved = current | {'digest': page_flow.digest(current)}
    index = int(current['batch_id'].rsplit(':', 1)[1])
    if index == len(value['batches']):
        value['batches'].append(saved)
    else:
        value['batches'][index] = saved
    write_atomic(path(tid, session), json.dumps(value, ensure_ascii=False))
    return {'saved': True, 'next': next_batch(tid, session)}


def completed(tid, session):
    value, groups = read(tid, session)
    if len(value['batches']) != len(groups):
        raise ValueError('尚未完整核查全部招标要求')
    rows = []
    docs = {d['id']: d for d in review.documents(tid)}
    for n, (batch, group) in enumerate(zip(value['batches'], groups)):
        expected = {'batch_id': f'{value["stamp"]}:{n}', 'comparisons': batch['comparisons']}
        if page_flow.digest(expected) != batch['digest'] or [r['id'] for r in batch['comparisons']] != [r['id'] for r in group]:
            raise ValueError('批次证据或要求绑定被修改')
        for r in batch['comparisons']:
            refs = {kind: [{k: e[k] for k in ('document_id', 'start', 'end')} for e in r[kind]] for kind in ('tender', 'bid')}
            cited = review.resolve_evidence(docs, refs['tender'], refs['bid'], group[r['slot'] - 1]['tender'])
            if any(r[kind] != cited[kind] for kind in ('tender', 'bid')):
                raise ValueError('批次与当前原文不一致')
        rows.extend(batch['comparisons'])
    return rows


def finalize(tid, session, summary, limitations):
    for text in [summary, *limitations]: check_text(text)
    rows = completed(tid, session)
    issues = [p | {'id': f'{r["id"]}:issue:{n + 1}', 'requirement_id': r['id']} for r in rows for n, p in enumerate(r['problems'])]
    value = {'summary': summary, 'limitations': limitations, 'issues': issues,
        'requirements': [{'basis_id': r['id'], 'status': r['status'], **{kind: [{k: e[k] for k in ('document_id', 'start', 'end')} for e in r[kind]] for kind in ('tender', 'bid')}} for r in rows]}
    result = review.save_report(tid, session, value)
    report_path = review._report_path(tid, session)
    envelope = json.loads(report_path.read_text())
    envelope['audit'] = {'batches': len(read(tid, session)[0]['batches']), 'requirements': len(rows), 'assessments': {r['id']: r['assessment'] for r in rows}}
    write_atomic(report_path, json.dumps(envelope, ensure_ascii=False))
    return result | {'batches': len(read(tid, session)[0]['batches'])}
