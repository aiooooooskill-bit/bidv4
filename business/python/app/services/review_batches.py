"""Small comparison batches editable by the same auditor before completion; problems belong to a single requirement."""
import json
import re
from pathlib import Path
from pydantic import Field
from .review_schema import StrictModel, Evidence, RiskType, PlainItem
from typing import Literal
from ..parse import write_atomic
from . import review, page_flow, review_method

class Problem(StrictModel):
    risk_type: RiskType
    title: PlainItem
    explanation: str = Field(min_length=1)
    suggestion: str = Field(min_length=1)

class SourceFact(StrictModel):
    evidence: Evidence
    text: str = Field(min_length=1)

class ConflictSide(StrictModel):
    fact: SourceFact
    dimension: Literal['time_window', 'effort', 'response_delay', 'period', 'quantity', 'date', 'categorical', 'explicit_exclusion', 'other'] = Field(description='完成跨度/排期用time_window，授课工时或累计投入用effort；响应等待、维保有效期、数量、日期、明确属性值分别使用对应类型。不得把数值差异改写为categorical规避量纲检查。')

class ConflictProof(StrictModel):
    parameter: PlainItem
    tender: ConflictSide
    bid: ConflictSide

class Comparison(StrictModel):
    slot: int = Field(ge=1, strict=True)
    tender: list[Evidence] = Field(min_length=1)
    bid: list[Evidence]
    bid_facts: list[SourceFact]
    conflicts: list[ConflictProof]
    applicability_reason: str = Field(min_length=1)
    applicability: Literal['established', 'uncertain']
    status: Literal['responded', 'missing', 'uncertain', 'conflict', 'informational']
    assessment: str = Field(min_length=1)
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


def evidence_index_path(tid, session):
    return path(tid, session).with_suffix('.md')


def write_evidence_index(tid, session, value):
    # A readable view of this round's canonical receipts, not model summaries.
    lines = ['# 本轮已取证原文', '仅作回查入口；按原文区段精读，不把一项的判断套给另一项。']
    for batch in value['batches']:
        lines.append(f'\n## 批次 {batch["batch_id"]}')
        for row in batch['comparisons']:
            lines.append(f'\n### {row["id"]} · {row["category"]} · {row["status"]}')
            for kind in ('tender', 'bid'):
                for e in row[kind]:
                    lines.append(f'\n{kind} {e["document_id"]} {e["start"]}-{e["end"]}\n{e["quote"]}')
    write_atomic(evidence_index_path(tid, session), '\n'.join(lines))


def comparison_input(row):
    result = {k: row[k] for k in ('slot', 'status', 'assessment', 'tender', 'bid', 'applicability', 'applicability_reason', 'bid_facts', 'conflicts', 'problems')}
    return result | {kind: [{k: e[k] for k in ('document_id', 'start', 'end')} for e in row[kind]] for kind in ('tender', 'bid')}


def next_batch(tid, session, batch_id=None):
    value, groups = read(tid, session)
    if not evidence_index_path(tid, session).is_file():
        write_evidence_index(tid, session, value)
    if batch_id is not None:
        batch = next((b for b in value['batches'] if b['batch_id'] == batch_id), None)
        if batch is None:
            raise ValueError('只能回读本轮已经保存的批次')
        return {'batch_id': batch_id, 'saved_results': [comparison_input(r) for r in batch['comparisons']]}
    n = len(value['batches'])
    if n == len(groups):
        return {'complete': True, 'accepted': sum(len(b['comparisons']) for b in value['batches']), 'total_batches': n,
                'evidence_index_path': str(evidence_index_path(tid, session))}
    return {'batch_id': f'{value["stamp"]}:{n}', 'batch': n + 1, 'total_batches': len(groups),
            'accepted': sum(len(b['comparisons']) for b in value['batches']),
            'evidence_index_path': str(evidence_index_path(tid, session)),
            # Analysis rows are navigation metadata; the actual cited clauses alone
            # define obligations, limits and consequences in the model-facing batch.
            'requirements': [{'id': r['id'], 'category': r['category'], 'analysis_locator': r['text'], 'slot': i + 1, 'response_duty': 'information_only' if review_method.information_only(r) else 'compare_bid', 'tender': [quote(tid, e) for e in r['tender']]} for i, r in enumerate(groups[n])]}


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
        for text in [result['assessment'], result['applicability_reason'], *[v for p in result['problems'] for k, v in p.items() if k != 'risk_type']]:
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
        if result['applicability'] == 'uncertain':
            if result['status'] != 'uncertain' or any(p['risk_type'] != 'confirmation' for p in result['problems']):
                raise ValueError(f'slot {result["slot"]}：条款适用范围或条件未明确，须用uncertain及需确认，不能直接判冲突或评分/废标后果')
        if result['status'] in ('responded', 'conflict') and not result['bid_facts']:
            raise ValueError(f'slot {result["slot"]}：已响应/冲突须列出实际投标原文事实')
        if result['status'] == 'conflict' and not result['conflicts']:
            raise ValueError(f'slot {result["slot"]}：冲突须有同一对象、同一参数量纲的成对原文证据；未重复或未定位不等于明确冲突')
        if result['status'] != 'conflict' and result['conflicts']:
            raise ValueError('未确认为冲突的条目不填写conflicts；适用范围不明保留需确认')
        for proof in result['conflicts']:
            if proof['tender']['dimension'] != proof['bid']['dimension']:
                raise ValueError(f'slot {result["slot"]}：不能比较不同参数类型；完成窗口/排期不等于授课或工作投入量，须回查原文后更正')
        facts = [(f, 'bid', 'bid_facts') for f in result['bid_facts']]
        facts.extend((p[kind]['fact'], kind, 'conflicts') for p in result['conflicts'] for kind in ('tender', 'bid'))
        for fact, kind, field in facts:
            e = fact['evidence']
            if not any(c['document_id'] == e['document_id'] and c['start'] <= e['start'] <= e['end'] <= c['end'] for c in cited[kind]):
                raise ValueError(f'slot {result["slot"]}：{field}须关联本项对应角色的证据卡')
            if not fact['text'].strip() or fact['text'] not in review.source_excerpt(docs[e['document_id']]['path'], e['start'], e['end']):
                raise ValueError(f'slot {result["slot"]}：{field}必须逐字摘录实际原文，不能以归纳代替或把招标要求写成投标事实')
        compiled.append(req | result | cited | {'qualifications': cited['tender']})
    return {'batch_id': batch_id, 'comparisons': compiled}


def accept(tid, session, proposed):
    # Recompute from canonical catalog and source immediately before write.
    results = [comparison_input(r) for r in proposed['comparisons']]
    current = candidate(tid, session, proposed['batch_id'], results)
    if current != proposed:
        raise ValueError('保存期间引用或要点已变化')
    value, _ = read(tid, session)
    links = shared_evidence(tid, value, current)
    saved = current | {'digest': page_flow.digest(current)}
    index = int(current['batch_id'].rsplit(':', 1)[1])
    if index == len(value['batches']):
        value['batches'].append(saved)
    else:
        value['batches'][index] = saved
    write_atomic(path(tid, session), json.dumps(value, ensure_ascii=False))
    write_evidence_index(tid, session, value)
    return {'saved': True, 'shared_evidence': links, 'next': next_batch(tid, session)}


def shared_evidence(tid, value, current):
    """Exact source-interval joins; no semantic retrieval, ranking or verdict."""
    linked = {}
    for batch in value['batches']:
        if batch['batch_id'] == current['batch_id']:
            continue
        for previous in batch['comparisons']:
            for row in current['comparisons']:
                for kind in ('tender', 'bid'):
                    for a in previous[kind]:
                        for b in row[kind]:
                            if a['document_id'] != b['document_id']:
                                continue
                            start, end = max(a['start'], b['start']), min(a['end'], b['end'])
                            if start > end:
                                continue
                            key = (a['document_id'], start, end)
                            if key not in linked:
                                linked[key] = {'source': quote(tid, {'document_id': key[0], 'start': start, 'end': end}), 'earlier_items': []}
                            item = {'batch_id': batch['batch_id'], 'slot': previous['slot'], 'id': previous['id'], 'status': previous['status']}
                            if item not in linked[key]['earlier_items']:
                                linked[key]['earlier_items'].append(item)
    return list(linked.values())


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


def audit_view(rows, batches):
    return {'batches': batches, 'requirements': len(rows),
        'assessments': {r['id']: '\n'.join([*['招标原文限定：' + q['quote'] for q in r['qualifications']], '适用性判断：' + r['applicability_reason'], r['assessment']]) for r in rows},
        'evidence_notes': {r['id']: {k: r[k] for k in ('applicability', 'applicability_reason', 'qualifications', 'bid_facts', 'conflicts')} for r in rows}}


def finalize(tid, session, limitations):
    for text in limitations: check_text(text)
    rows = completed(tid, session)
    issues = [p | {'id': f'{r["id"]}:issue:{n + 1}', 'requirement_id': r['id']} for r in rows for n, p in enumerate(r['problems'])]
    value = {'limitations': limitations, 'issues': issues,
        'requirements': [{'basis_id': r['id'], 'status': r['status'], **{kind: [{k: e[k] for k in ('document_id', 'start', 'end')} for e in r[kind]] for kind in ('tender', 'bid')}} for r in rows]}
    result = review.save_report(tid, session, value)
    report_path = review._report_path(tid, session)
    envelope = json.loads(report_path.read_text())
    envelope['audit'] = audit_view(rows, len(read(tid, session)[0]['batches']))
    write_atomic(report_path, json.dumps(envelope, ensure_ascii=False))
    return result | {'batches': len(read(tid, session)[0]['batches'])}
