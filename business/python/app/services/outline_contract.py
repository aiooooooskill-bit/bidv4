"""目录派发与汇总的业务契约；分类由本项目证据确定，结构检查由程序执行。"""
from __future__ import annotations

import hashlib
import json
import re
import textwrap
from copy import deepcopy
from pathlib import Path
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

from .. import artifact_store
from ..config import data_dir
from .outline_units import decision_units
from ..file_lock import file_lock


class Binding(BaseModel):
    model_config = ConfigDict(extra='forbid')
    source_id: str
    path: list[str] = Field(min_length=1)


class HeadingRequirement(Binding):
    quote: str = Field(min_length=2, description='本项目该来源中的独立分类原文短语，不用自行创造的标题作为引用')


class ContentHeading(BaseModel):
    model_config = ConfigDict(extra='forbid')
    path: list[str] = Field(min_length=2, max_length=3)
    body_path: str
    block: int = Field(ge=1)
    reason: str = Field(min_length=12)


class VolumePlan(BaseModel):
    model_config = ConfigDict(extra='forbid')
    name: str = Field(min_length=1)
    root_titles: list[str] = Field(min_length=1)
    headings: list[HeadingRequirement] = Field(description='需独立成标题的每项实质分类，分别列出；已有同义标题写已有路径')
    bindings: list[Binding] = Field(description='来源到实际内容节点的映射；参数、证明材料可由节点范围覆盖，不必逐项成标题')
    content_headings: list[ContentHeading] = Field(default_factory=list)


class Exclusion(BaseModel):
    model_config = ConfigDict(extra='forbid')
    source_id: str
    reason: str = Field(min_length=8)


class Target(BaseModel):
    model_config = ConfigDict(extra='forbid')
    volume: str
    path: list[str] = Field(min_length=1)


class UnitDecision(BaseModel):
    model_config = ConfigDict(extra='forbid')
    unit_id: str
    kind: Literal['heading', 'detail', 'rubric', 'proof', 'procedure', 'out_of_scope']
    reason: str = Field(min_length=12, description='根据该片段性质说明为何独立成标题或只作细节/评分档次/证明/程序；不能用大章已覆盖作为独立分类不成标题的理由')
    targets: list[Target]


class VolumePatch(BaseModel):
    model_config = ConfigDict(extra='forbid')
    name: str = Field(min_length=1)
    root_titles: list[str] = Field(default_factory=list, description='尚无目录树的册首次给出全部实际一级标题，前两项为封面、目录；已有目录由程序保留原一级，后续批次可留空')
    bindings: list[Binding] = Field(default_factory=list, max_length=8)
    content_headings: list[ContentHeading] = Field(default_factory=list, max_length=8)


class PlanBatch(BaseModel):
    model_config = ConfigDict(extra='forbid')
    volumes: list[VolumePatch] = Field(default_factory=list, max_length=2)
    exclusions: list[Exclusion] = Field(default_factory=list, max_length=8)
    decisions: list[UnitDecision] = Field(default_factory=list, max_length=6)
    replace_sources: list[str] = Field(default_factory=list, max_length=8, description='回读本项目证据确认旧来源错标时，列出待重新归位的来源ID；同批给出该来源的正确headings/bindings，原节点和说明仍保留')
    complete: bool = Field(default=False, description='全部来源和units提交齐备后，最后单独提交complete=true冻结；冻结前须先实际派发和审查，不能发布')


def path(tid):
    return data_dir() / 'outline-runs' / (tid + '.json')


def fragment_path(tid, name):
    from ..tools.body_contract import volume_key
    return artifact_store.work_dir(tid) / 'outline/fragments' / (volume_key(name) + '.md')


def context_path(tid):
    return path(tid).with_suffix('.context.json')


def _save(tid, value):
    artifact_store._atomic_write(path(tid), json.dumps(value, ensure_ascii=False, indent=2))


def _load(tid):
    p = path(tid)
    if not p.is_file():
        raise ValueError('本轮目录契约尚未启动，请从目录阶段开始')
    return json.loads(p.read_text())


def _inputs(tid):
    root = artifact_store.task_dir(tid)
    result = {}
    for folder in ('sources', 'work/analysis', 'work/parse'):
        for p in sorted((root / folder).rglob('*')):
            if p.is_file():
                result[str(p.relative_to(root))] = hashlib.sha256(p.read_bytes()).hexdigest()
    return result


def _nodes(nodes, parent=()):
    for n in nodes:
        key = (*parent, n['目录名称'])
        yield key, n
        yield from _nodes(n.get('children', []), key)


def _docs(text):
    from ..tools.assemble_tender import _parse_response_docs
    warnings = []
    docs = _parse_response_docs(text, warnings)
    if warnings:
        raise ValueError('；'.join(warnings))
    return docs


def _preamble(text):
    from ..markdown import headings
    start = next((h.line - 1 for h in headings(text) if h.level == 1 and re.match(r'^响应文件[：:]', h.title)), len(text.splitlines()))
    return '\n'.join(text.splitlines()[:start]).strip()


def enrich_registry(registry, work, names):
    from ..tools.validate_analysis import citation_ranges
    # 把摘要引用到的原文按真实行号去重保留；不是把细点机械升成标题。
    evidence, evidence_refs = {}, {}
    for rid, entry in registry.items():
        if not rid.startswith(('REQ-', 'SCORE-')):
            continue
        citation = entry['出处']
        for name, start, end in citation_ranges(citation, names, {'file': None}):
            p = work / 'parse' / name / (name + '.md')
            if not p.is_file():
                continue
            lines = p.read_text().splitlines()
            if start < 1 or end > len(lines) or end < start:
                raise ValueError(f'{rid}原文引用越界：{citation}')
            for number in range(start, end + 1):
                evidence.setdefault(name, {})[str(number)] = lines[number - 1]
                evidence_refs.setdefault(rid, []).append([name, str(number)])
    for rid, refs in evidence_refs.items():
        registry[rid]['原文依据'] = '\n'.join(f'{name} L{line}: {evidence[name][line]}' for name, line in dict.fromkeys(tuple(r) for r in refs))
    return evidence, evidence_refs


def begin(tid, action_id):
    from ..tools.assemble_tender import (_build_mand_tpl_registry, _build_req_registry,
                                        _build_score_registry, _parse_response_docs)
    work = artifact_store.work_dir(tid)
    from .page_flow import source_selection
    selection = source_selection(tid)
    names = [n for n in [selection['main'], *(s['file'] for s in selection['supplements'])] if n]
    texts = {n: (work / 'analysis' / n).read_text() for n in
             ('requirements-format.md', 'requirements-business.md', 'evaluation.md')}
    mand, tpl = _build_mand_tpl_registry(texts['requirements-format.md'], names)
    registry = {**mand, **tpl, **_build_req_registry(texts['requirements-business.md'], names),
                **_build_score_registry(texts['evaluation.md'], names)}
    evidence, evidence_refs = enrich_registry(registry, work, names)
    p = work / 'outline/tender-response-docs.md'
    baseline_md = p.read_text() if p.is_file() else ''
    from .page_flow import directory
    from ..contracts.tender_directory import ResponseDocument
    current = directory(tid)
    baseline = ([ResponseDocument.model_validate(d).model_dump() for d in current['content']['response_documents']]
                if current else _parse_response_docs(baseline_md))
    from .body_inventory import snapshot
    body_inventory = snapshot(tid, {'response_documents': baseline})
    facts_path = path(tid).with_suffix('.txt')
    readable = []
    for rid, entry in registry.items():
        readable.append(rid)
        for key, text in entry.items():
            readable.append(key + '：')
            readable.extend(textwrap.wrap(str(text), width=100, replace_whitespace=False))
        readable.append('')
    units = decision_units(registry)
    readable.append('以下必审片段须在outline_plan.decisions逐项判断；独立实质分类选heading，评分档次/证明/具体参数保留为相应内容。其他来源仅新增标题时须用其可选unit作heading决策，不因独立编号就成标题。')
    for uid, unit in units.items():
        if not unit['review_required']:
            continue
        readable.append(uid)
        readable.extend(textwrap.wrap(unit['text'], width=100))
    artifact_store._atomic_write(facts_path, '\n'.join(readable))
    value = dict(action_id=action_id, inputs=_inputs(tid), units=units, registry=registry, evidence=evidence, evidence_refs=evidence_refs,
                 facts_path=str(facts_path), baseline=baseline, baseline_markdown=baseline_md, body_inventory=body_inventory, aligned_volumes=[], plan=None)
    _save(tid, value)
    # 模型读语义上下文与完整事实；输入哈希、重复原文索引和原始Markdown仅供程序校验。
    context = dict(action_id=action_id, registry={rid: {k: v for k, v in entry.items() if k not in ('评分要点', '原文依据')} for rid, entry in registry.items()}, units={u: v for u, v in units.items() if v['review_required']}, optional_heading_unit_ids=[u for u, v in units.items() if not v['review_required']], baseline=baseline, baseline_source='页面当前已保存目录' if current else '首次生成的工作稿', body_inventory=body_inventory, facts_path=str(facts_path))
    artifact_store._atomic_write(context_path(tid), json.dumps(context, ensure_ascii=False, indent=2))
    return {'context_path': str(context_path(tid)), 'facts_path': str(facts_path), 'baseline_volumes': [d['name'] for d in baseline],
            'instruction': '先read完整context_path和facts_path。先outline_plan(operation="begin")承接本项目分册骨架（已有实际目录树无需其他参数；只有册名和scope的空草稿仍逐册填volume和root_titles，全部一级标题从封面、目录开始，不能只填正文），暂不complete。有SCORE评分时，单册和多册都必须先task派发本项目对应册的tender-outline-writer独立评分对齐；未完成真实子代理检查，程序拒绝提交decisions或complete。多册，不能先以旧综合章概述把分类判作参数。已有多册汇总恢复时，含方案/能力类评分且仍未展开的册须先重派清理，其余册不动。单册先按原文完成实际目录后也须子代理独立对齐。随后主线程回读真实目录，对context.units必审片段逐项用operation="decide"审查，每项填写unit_id/kind/reason/volume及level1/2/3；各字段直接填标量，不传嵌套JSON。每轮最多6次调用并读回执。不仅评分，格式/文件组成明确命名的方案类别也须逐类核对用户要求及已有正文，补齐适用类别；不能因无评分或正文尚缺而省略已知类别。独立评分/实质类别须真实二三级标题；有明确取值、阈值、时长、频率或字段的才是具体参数，类别内含参数或举例不改变其独立评分性质。全部审查后operation="complete"冻结，check_outline并组装发布；未冻结不能发布。原节点/顺序/scope/概述/归位理由必须保留；独立附件不得降挂。'}


def _needs_alignment(value):
    return any(r.startswith('SCORE-') for r in value['registry']) and not value['aligned_volumes']


def _require_aligned_volumes(value, names):
    missing = set(names) - set(value['aligned_volumes'])
    if missing:
        raise ValueError('对应册尚未完成真实子代理评分对齐，其他册完成不能替代本册；先task填写response_file重派：' + '、'.join(sorted(missing)))


def _source_review(tid, value, volumes):
    """主线程复核真实子稿的来源变更；不替模型判断旧来源正确与否。"""
    result = []
    for vol in volumes:
        old = next((d for d in value['baseline'] if d['name'] == vol.name), None)
        file = fragment_path(tid, vol.name)
        if not old or not file.is_file():
            continue
        docs = _docs(file.read_text())
        if len(docs) != 1 or docs[0]['name'] != vol.name:
            continue
        actual = dict(_nodes(docs[0]['directory']))
        for p, node in _nodes(old['directory']):
            current = actual.get(p, {})
            before = set(node.get('来源位置', []) + node.get('理由来源', [])) & set(value['registry'])
            now = set(current.get('来源位置', []) + current.get('理由来源', []))
            removed = before - now
            if removed:
                planned = {b.source_id for b in [*vol.headings, *vol.bindings] if tuple(b.path) == p}
                result.append({'volume': vol.name, 'path': p, 'removed_original_sources': sorted(removed),
                               'actual_sources': sorted(now), 'still_planned': sorted(removed & planned)})
    return result


def freeze_plan(tid, volumes: list[VolumePlan], exclusions: list[Exclusion], decisions: list[UnitDecision], *, complete=True):
    if not volumes:
        raise ValueError('须声明至少一个真实响应文件')
    value = _load(tid)
    if complete and _needs_alignment(value):
        raise ValueError('有评分内容时须先完成真实子代理评分对齐，不能由主代理预判分类后冻结')
    if complete:
        _require_aligned_volumes(value, [v.name for v in volumes if any(h.source_id.startswith('SCORE-') for h in v.headings)])
    plan = {'volumes': [v.model_dump() for v in volumes], 'exclusions': [e.model_dump() for e in exclusions], 'decisions': [d.model_dump() for d in decisions]}
    if value['inputs'] != _inputs(tid):
        raise ValueError('来源或解读已变化，本轮目录依据已失效')
    old_plan = value['plan']
    if old_plan is not None:
        if old_plan == plan:
            return {'ok': True, 'frozen': True}
        same_structure = (old_plan['exclusions'] == plan['exclusions'] and old_plan['decisions'] == plan['decisions'] and len(old_plan['volumes']) == len(plan['volumes']))
        for before, after in zip(old_plan['volumes'], plan['volumes']):
            same_structure = same_structure and {k:v for k,v in before.items() if k!='bindings'} == {k:v for k,v in after.items() if k!='bindings'}
            same_structure = same_structure and {(b['source_id'],tuple(b['path'])) for b in before['bindings']}.issubset({(b['source_id'],tuple(b['path'])) for b in after['bindings']})
        if not same_structure:
            raise ValueError('本轮计划已冻结，不能因缺项或校验失败下调分类要求、删除或迁移既有来源；只允许向已批准标题追加核实过的来源绑定')
        if not complete:
            raise ValueError('来源绑定追加须在本次完整校验后冻结')
    names = [v.name for v in volumes]
    if len(set(names)) != len(names):
        raise ValueError('响应文件名称重复')
    old_docs = value['baseline']
    if old_docs:
        original_names = [d['name'] for d in old_docs]
        if names != [n for n in original_names if n in names] or (complete and names != original_names):
            raise ValueError('原有分册及顺序必须完整保留')
    registry = value['registry']
    required_units = {u for u, v in value['units'].items() if v['review_required']}
    accounted = set()
    for vol in volumes:
        old = next((d for d in old_docs if d['name'] == vol.name), None)
        if old and old['directory'] and vol.root_titles != [n['目录名称'] for n in old['directory']]:
            raise ValueError(f'{vol.name}：原一级标题和顺序必须逐字保留')
        if (not old or not old['directory']) and vol.root_titles[:2] != ['封面', '目录']:
            raise ValueError(f'{vol.name}：root_titles须包含全部实际一级标题，前两项依次为封面、目录，再列正文及独立附件；请修正本册begin参数后重试，错误计划未保存')
        if len(set(vol.root_titles)) != len(vol.root_titles):
            raise ValueError(f'{vol.name}：一级标题重复')
        seen = {}
        for h in vol.headings:
            entry = registry.get(h.source_id)
            if not entry:
                raise ValueError(f'不存在来源 {h.source_id}')
            source = '\n'.join(str(v) for v in entry.values()) + '\n'.join(value['evidence'][name][line] for name, line in value['evidence_refs'].get(h.source_id, []))
            if h.quote not in source:
                raise ValueError(f'{h.source_id}：分类引用不是本项目原文：{h.quote}')
            if (h.source_id, tuple(h.path)) in seen and seen[h.source_id, tuple(h.path)] != h.quote:
                raise ValueError('多个独立分类不能合并成一个标题路径')
            categories = set(re.findall(r'[\u4e00-\u9fffA-Za-z0-9]+方案', h.path[0]))
            if h.source_id.startswith('SCORE-') and len(h.path) == 2 and len(categories) >= 2 and re.search(r'方案\s*[、，,/与及和]', h.path[0]) and not any(h.path[-1] in c or c in h.path[-1] for c in categories):
                raise ValueError('综合一级章已明确列出多个方案类别：须先按本项目适用方案类别设二级，再将其独立评分子维度设三级；不能把子维度直接列为二级：' + ' → '.join(h.path))
            seen[h.source_id, tuple(h.path)] = h.quote
        declared_paths = {p for p, _ in _nodes(old['directory'])} if old else set()
        declared_paths.update((t,) for t in vol.root_titles)
        declared_paths.update(tuple(h.path[:i]) for h in vol.headings for i in range(1, len(h.path) + 1))
        for heading in vol.content_headings:
            body = next((b for b in value.get('body_inventory', []) if b['path'] == heading.body_path and b['volume'] == vol.name), None)
            evidence = next((h for h in body['headings'] if h['block'] == heading.block), None) if body else None
            origins = [p for p, n in _nodes(old['directory']) if body and n['目录名称'] == body['title']] if old else []
            if not evidence or evidence['title'] != heading.path[-1] or not any(tuple(heading.path[:len(p)]) == p for p in origins):
                raise ValueError('正文补充标题须对应本册原章节内的真实标题块，逐字保留原题并归入所属原章节：' + ' → '.join(heading.path))
            file = artifact_store.work_dir(tid) / body['path']
            if not file.is_file() or hashlib.sha256(file.read_bytes()).hexdigest() != body['sha256']:
                raise ValueError('正文补充标题的原文依据已变化，请重启目录核对')
            declared_paths.update(tuple(heading.path[:i]) for i in range(1, len(heading.path) + 1))
        for binding in [*vol.headings, *vol.bindings]:
            if tuple(binding.path) not in declared_paths:
                raise ValueError('新增标题须先作heading决策；参数/证明的bindings不能隐式新增标题：' + ' → '.join(binding.path))
            if binding.source_id not in registry or binding.path[0] not in vol.root_titles:
                raise ValueError(f'{vol.name}：来源或一级归属不合法：{binding.model_dump()}')
            if len(binding.path) > 3 and isinstance(binding, HeadingRequirement):
                raise ValueError('新增分类应在所属原一级章下归集为二级或三级标题')
            accounted.add(binding.source_id)
    for e in exclusions:
        if e.source_id not in registry or e.source_id in accounted:
            raise ValueError(f'排除来源不存在或同时被映射：{e.source_id}')
        accounted.add(e.source_id)
    if complete and set(registry) != accounted:
        raise ValueError('来源必须全部映射或逐项说明不成章原因，尚缺：' + ','.join(sorted(set(registry) - accounted)))
    if len({d.unit_id for d in decisions}) != len(decisions) or not {d.unit_id for d in decisions}.issubset(value['units']) or (complete and not required_units.issubset({d.unit_id for d in decisions})):
        raise ValueError('必须对units全部片段逐项分类判断，不能提交空标题清单跳过实质分类；尚缺：' + ','.join(required_units - {d.unit_id for d in decisions}))
    targets = {(v.name, tuple(b.path), b.source_id) for v in volumes for b in [*v.bindings, *v.headings]}
    heads = {(v.name, tuple(h.path), h.source_id): h.quote for v in volumes for h in v.headings}
    excluded = {e.source_id for e in exclusions}
    for decision in decisions:
        unit = value['units'][decision.unit_id]
        if not decision.targets and not (decision.kind == 'out_of_scope' and unit['source_id'] in excluded):
            raise ValueError(decision.unit_id + '：须给出实际承载路径或适用性排除')
        for target in decision.targets:
            key = (target.volume, tuple(target.path), unit['source_id'])
            if key not in targets:
                raise ValueError(decision.unit_id + '：决策路径未列入本册headings/bindings')
            if decision.kind == 'heading' and (key not in heads or heads[key] not in unit['text']):
                raise ValueError(decision.unit_id + '：独立分类须分别列headings，quote取该片段原文，并映射真实二三级标题')
    source_review = _source_review(tid, value, volumes)
    unresolved = [r for r in source_review if r['still_planned']]
    if complete and old_plan is None and unresolved:
        raise ValueError('子稿原来源移除尚未复核，不能先冻结错误映射。核对registry：旧错标用replace_source重建全部正确路径；旧有效来源则重派原册恢复。不能盲目照抄子稿或删来源消除报错：' + json.dumps(unresolved, ensure_ascii=False))
    if old_plan is not None:
        additions = [dict(volume=after['name'],**b) for before,after in zip(old_plan['volumes'],plan['volumes']) for b in after['bindings'] if b not in before['bindings']]
        value.setdefault('binding_additions_audit',[]).extend(additions)
    value['plan' if complete else 'draft_plan'] = plan
    _save(tid, value)
    pending_sources = sorted(set(registry) - accounted)
    pending_units = sorted(required_units - {d.unit_id for d in decisions})
    return {'ok': True, 'frozen': complete,
            'remaining_source_count': len(pending_sources), 'next_source_ids': pending_sources[:8],
            'remaining_decision_count': len(pending_units),
            'next_decision_unit_ids': [] if _needs_alignment(value) else pending_units[:6],
            'source_changes_to_review': source_review,
            'next_action': 'task独立评分对齐' if _needs_alignment(value) else '依据实际目录继续逐项审查'}


def plan_batch(tid, batch: PlanBatch):
    # Parallel native tool calls must not overwrite another accepted batch.
    with file_lock(path(tid)):
        return _plan_batch(tid, batch)


def _plan_batch(tid, batch: PlanBatch):
    value = _load(tid)
    if (batch.decisions or batch.complete) and _needs_alignment(value):
        raise ValueError('执行顺序错误：本轮尚未完成真实子代理评分对齐。先outline_plan(operation="begin")承接原骨架（新目录逐册填volume及换行分隔的root_titles），再task填写response_file派发对应册；单册也须独立评分对齐。暂不要提交decisions或complete。')
    extending = value['plan'] is not None
    if extending and batch.complete and not any([batch.volumes,batch.exclusions,batch.decisions,batch.replace_sources]):
        return {'ok':True,'frozen':True}
    if extending and any([batch.exclusions,batch.decisions,batch.replace_sources]):
        raise ValueError('计划已冻结，只能追加核实过的来源bindings；不能减少或修改原分类/节点/既有映射')
    draft = deepcopy(value['plan'] if extending else value.get('draft_plan')) or {'volumes': [dict(name=d['name'],root_titles=[n['目录名称'] for n in d['directory']],headings=[],bindings=[dict(source_id=rid,path=list(p)) for p,n in _nodes(d['directory']) for rid in sorted(set([*n.get('来源位置', []),*n.get('理由来源', [])]) & set(value['registry']))]) for d in value['baseline'] if d['directory']], 'exclusions': [], 'decisions': []}
    if not set(batch.replace_sources).issubset(value['registry']):
        raise ValueError('待纠正来源不在本项目registry中')
    for vol in draft['volumes']:
        vol['bindings'] = [b for b in vol['bindings'] if b['source_id'] not in batch.replace_sources]
    for patch in batch.volumes:
        vol = next((v for v in draft['volumes'] if v['name'] == patch.name), None)
        if vol is None:
            if not patch.root_titles:
                raise ValueError('新册首次提交须给出本项目的root_titles')
            vol = dict(name=patch.name,root_titles=patch.root_titles,headings=[],bindings=[])
            draft['volumes'].append(vol)
        elif patch.root_titles and patch.root_titles != vol['root_titles']:
            raise ValueError('已确定的一级标题和顺序不能改变')
        for key in ('bindings', 'content_headings'):
            vol.setdefault(key, [])
            for item in getattr(patch, key):
                row=item.model_dump()
                if row not in vol[key]:
                    vol[key].append(row)
    if value['baseline']:
        original_names = [d['name'] for d in value['baseline']]
        draft['volumes'].sort(key=lambda v: original_names.index(v['name']) if v['name'] in original_names else len(original_names))
    for item in batch.exclusions:
        row=item.model_dump()
        if row not in draft['exclusions']:
            draft['exclusions'].append(row)
    for item in batch.decisions:
        row=item.model_dump()
        old=next((d for d in draft['decisions'] if d['unit_id']==item.unit_id), None)
        if old is not None and old != row:
            preserved = {k:v for k,v in old.items() if k!='targets'} == {k:v for k,v in row.items() if k!='targets'} and all(t in row['targets'] for t in old['targets'])
            if not preserved:
                raise ValueError('已确认的逐项判断不能因执行失败而改写：'+item.unit_id)
            draft['decisions'][draft['decisions'].index(old)] = row
        if old is None:
            draft['decisions'].append(row)
        if item.unit_id not in value['units']:
            raise ValueError('不存在待判断片段：'+item.unit_id)
        unit=value['units'][item.unit_id]
        if unit['source_id'].startswith('SCORE-') and item.kind == 'heading':
            _require_aligned_volumes(value, [t.volume for t in item.targets])
        for target in item.targets:
            vol=next((v for v in draft['volumes'] if v['name']==target.volume), None)
            if vol is None:
                raise ValueError('分类目标册未声明：'+target.volume)
            binding=dict(source_id=unit['source_id'],path=target.path)
            if item.kind=='heading':
                heading={**binding,'quote':unit['text']}
                if heading not in vol['headings']:
                    vol['headings'].append(heading)
            elif binding not in vol['bindings']:
                vol['bindings'].append(binding)
    return freeze_plan(tid, [VolumePlan.model_validate(v) for v in draft['volumes']], [Exclusion.model_validate(e) for e in draft['exclusions']], [UnitDecision.model_validate(d) for d in draft['decisions']], complete=batch.complete or extending)


def dispatch(tid, name):
    value = _load(tid)
    draft = value['draft_plan'] if value['plan'] is None and 'draft_plan' in value else value['plan']
    if draft is None:
        raise ValueError('先outline_plan(operation="begin")承接本项目分册骨架（已有目录无需其他参数），再派发本册；不要预先把综合章下的独立评分类别判成参数')
    vol = next((v for v in draft['volumes'] if v['name'] == name), None)
    if not vol:
        raise ValueError('派发册不属于本轮冻结计划')
    target = fragment_path(tid, name)
    if not target.is_file() and value['baseline_markdown']:
        if len(value['baseline']) == 1:
            artifact_store._atomic_write(target, value['baseline_markdown'])
        else:
            from ..markdown import sections
            for heading, body in sections(value['baseline_markdown'], 1):
                if re.sub(r'^响应文件[：:]\s*', '', heading.title).strip() == name:
                    artifact_store._atomic_write(target, '# ' + heading.title + '\n\n' + body)
                    break
    return {'phase': 'classification_frozen' if value['plan'] is not None else 'structure_locked', 'volume': vol, 'context_path': str(context_path(tid)), 'facts_path': value['facts_path'],
            'fragment_path': str(target), 'instruction': '以context.baseline中的当前已保存目录为保全基线；已有fragment或汇总Markdown可能早于页面人工编辑，须按基线恢复最新节点、顺序与说明，不能用旧稿覆盖人工修改。旧稿中的全局说明仍保留。'}


def _check_doc(value, vol, doc, *, classification_frozen=True):
    errors = []
    actual = dict(_nodes(doc['directory']))
    if len(actual) != sum(1 for _ in _nodes(doc['directory'])):
        errors.append('存在重复目录路径')
    if [n['目录名称'] for n in doc['directory']] != vol['root_titles']:
        errors.append('一级标题/顺序与冻结计划不符；不能拆章、重排或把独立附件降挂')
    old = next((d for d in value['baseline'] if d['name'] == vol['name']), None)
    if old:
        before = list(_nodes(old['directory']))
        old_paths = [p for p, _ in before]
        if [p for p in actual if p in old_paths] != old_paths:
            errors.append('原有节点路径、父级或顺序发生丢失/改变')
        if old['scope'] and old['scope'] not in doc['scope']:
            errors.append('原有scope内容缺失')
        for p, n in before:
            now = actual.get(p, {})
            for field in ('节点概述', '归位理由', '交付形态'):
                if n.get(field) and n[field] not in now.get(field, ''):
                    errors.append(' → '.join(p) + f'：原{field}缺失')
    for rule in [*vol['headings'], *vol['bindings']] if classification_frozen else []:
        p = tuple(rule['path'])
        node = actual.get(p)
        if node is None:
            errors.append('缺少实际标题路径：' + ' → '.join(p))
        elif rule['source_id'] not in [*node.get('来源位置', []), *node.get('理由来源', [])]:
            errors.append(' → '.join(p) + '：缺少计划来源 ' + rule['source_id'])
    declared_paths = {p for p, _ in _nodes(old['directory'])} if old else set()
    declared_paths.update((t,) for t in vol['root_titles'])
    declared_paths.update(tuple(h['path'][:i]) for h in vol['headings'] for i in range(1, len(h['path']) + 1))
    for h in vol.get('content_headings', []):
        declared_paths.update(tuple(h['path'][:i]) for i in range(1, len(h['path']) + 1))
        if classification_frozen and tuple(h['path']) not in actual:
            errors.append('缺少正文归集标题路径：' + ' → '.join(h['path']))
    for p, n in actual.items():
        if classification_frozen and p not in declared_paths:
            errors.append(' → '.join(p) + '：新增标题不在冻结分类计划中，不能把普通参数/证明或例子自行升为标题')
        unknown = set([*n.get('来源位置', []), *n.get('理由来源', [])]) - set(value['registry'])
        if unknown:
            errors.append(' → '.join(p) + '：悬空来源 ' + ','.join(sorted(unknown)))
        allowed = {r['source_id'] for r in [*vol['headings'], *vol['bindings']] if tuple(r['path']) == p}
        extra = set([*n.get('来源位置', []), *n.get('理由来源', [])]) - allowed
        if classification_frozen and extra:
            errors.append(' → '.join(p) + '：来源挂接不符合已核定路径 ' + ','.join(sorted(extra)) + '（须同时核对来源标注及目录说明的理由来源两处；原归位理由、概述文字继续保留。若回读registry已核实该来源确与此标题语义一致，可outline_plan仅追加该路径的bindings，保留合法新关联；不能为消除报错审批不相关来源，不能删改已冻结分类或既有有效来源）')
    return errors


def check(tid, volume='', *, child_completed=False):
    value = _load(tid)
    if value['inputs'] != _inputs(tid):
        raise ValueError('来源/解读/解析依据已变化，不能沿用本轮校验')
    classification_frozen = value['plan'] is not None
    if not classification_frozen and (not volume or 'draft_plan' not in value):
        raise ValueError('先回读真实目录完成逐项分类并complete冻结，再检查全部目录；分册编写期间只做原结构保留检查，不代表可发布')
    current = value['plan'] if classification_frozen else value['draft_plan']
    if volume and volume not in {v['name'] for v in current['volumes']}:
        raise ValueError('检查册不属于本轮骨架')
    errors = []
    for vol in current['volumes']:
        if volume and volume != vol['name']:
            continue
        p = fragment_path(tid, vol['name'])
        if len(current['volumes']) == 1 and not volume:
            p = artifact_store.work_dir(tid) / 'outline/tender-response-docs.md'
        if not p.is_file():
            errors.append(vol['name'] + '：目录文件不存在')
            continue
        docs = _docs(p.read_text())
        if len(docs) != 1 or docs[0]['name'] != vol['name']:
            errors.append(vol['name'] + '：目录文件分册不符')
        else:
            errors.extend(vol['name'] + '：' + e for e in _check_doc(value, vol, docs[0], classification_frozen=classification_frozen))
    if errors:
        raise ValueError('目录检查未通过，仅修正受影响册后重新检查：\n' + '\n'.join(errors))
    if child_completed and volume not in value['aligned_volumes']:
        value['aligned_volumes'].append(volume)
        _save(tid, value)
    return {'ok': True, 'phase': 'classification_frozen' if classification_frozen else 'structure_only', 'volume': volume or '全部', 'action_id': value['action_id']}


def require_publish(tid, content):
    from ..tools.assemble_tender import _fold_lineage
    if not path(tid).is_file():
        return  # 非目录AI执行（例如编辑器保存）不属于此运行契约。
    value = _load(tid)
    if value['plan'] is None:
        raise ValueError('分类审查计划尚未complete冻结，不能发布；先回读实际目录完成逐项核验')
    check(tid)
    actual_markdown = (artifact_store.work_dir(tid) / 'outline/tender-response-docs.md').read_text()
    original_preamble = _preamble(value['baseline_markdown'])
    if original_preamble and original_preamble not in _preamble(actual_markdown):
        raise ValueError('原目录汇总中的项目信息或全局说明缺失；分册可只输出本册，主线程汇总须完整保留原文件首部')
    docs = _docs(actual_markdown)
    planned = value['plan']['volumes']
    if [d['name'] for d in docs] != [v['name'] for v in planned]:
        raise ValueError('汇总分册/顺序与冻结计划不符')
    for doc, vol in zip(docs, planned):
        errors = _check_doc(value, vol, doc)
        if errors:
            raise ValueError('\n'.join(errors))
        if len(planned) > 1 or vol['name'] in value['aligned_volumes']:
            fragment = fragment_path(tid, vol['name'])
            if doc != _docs(fragment.read_text())[0]:
                raise ValueError(vol['name'] + '：汇总结果与已检查的fragment不一致')
    folded = [{**d, 'directory': _fold_lineage(d['directory'])[0]} for d in docs]
    if content['response_documents'] != folded or content['registry'] != value['registry']:
        raise ValueError('发布内容与本轮实际目录或完整来源登记表不一致')


def status(tid, action_id):
    try:
        value = _load(tid)
        if value['action_id'] != action_id:
            raise ValueError('当前目录执行已变化')
        from .page_flow import directory
        current = directory(tid)
        if not current:
            raise ValueError('目录尚未发布')
        require_publish(tid, current['content'])
        return {'ok': True}
    except ValueError as e:
        return {'ok': False, 'error': str(e)}
