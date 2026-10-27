"""把既有正文按当前目录归集；只移动完整 OOXML 块，不转写正文。"""
from __future__ import annotations

import hashlib
import json
from collections import Counter
from contextlib import ExitStack
from copy import deepcopy
from io import BytesIO

from docx import Document
from docx.oxml.ns import qn
from lxml import etree

from .. import artifact_store, runctx
from . import body_contract


def _blocks(doc):
    blocks = [e for e in doc.element.body if e.tag != qn('w:sectPr')]
    if any(e.tag not in (qn('w:p'), qn('w:tbl')) for e in blocks):
        raise ValueError('正文含非段落/表格的顶层对象，尚不能可靠拆分，请先核查原件；未改动文件')
    return blocks


def _source_node(tid, relative):
    _, content, _ = body_contract.load_directory(tid)
    if not content:
        raise ValueError('须先有当前投标目录')
    matches = []
    for doc in content.get('response_documents', []):
        vol = body_contract.document_name(doc)
        prefix = 'body/' + (body_contract.volume_key(vol) + '/' if body_contract.multi_volume(content) else '')
        def visit(nodes, ancestors=()):
            for node in nodes:
                if prefix + body_contract.sanitize_name(node['目录名称']) + '.docx' == relative:
                    matches.append((prefix, node, ancestors))
                visit(node.get('children', []), (*ancestors, node))
        visit(doc.get('directory', []))
    if len(matches) != 1:
        raise ValueError('原正文路径须唯一对应当前目录节点，不能猜测同名章节')
    return matches[0]


def docx_section_repartition(path: str, assignments_json: str = '', expected_sha256: str = '') -> str:
    """将既有正文完整归集到本节点、子孙或有独立正文的祖先，保全原文字、表格、图片、样式及关系。

    先只传path读取B1起的正文块顺序、标题和sha256。标题段也在块编号中，
    所有块必须恰好分配一次，不能遗漏/重复；无法确认归属的块留在父节点。
    assignments_json是JSON字符串：[{"title":"当前目录中的完整标题","ranges":[[1,3],[8,9]]},...]。
    写入必须传读到的expected_sha256。允许将错放子节的声明归回本册祖先；仅限read返回的allowed_titles，不开放兄弟节或跨册，不覆盖已有目标。
    不把原文件整段重复粘入每个子节，不生成新正文或新标题，不因拆分自动标成已校验。
    返回的每个输出须validate_body；之后合册按当前树序并入父节点正文及子节。
    """
    from .docx_ops import _dest_path, _docx_path_lock, _atomic_save
    from ..services import build_state
    current = runctx.current_run()
    if current is None or not current.task_id:
        raise ValueError('当前会话未归属任务')
    tid = current.task_id
    source, relative = _dest_path(tid, path, must_exist=True)
    prefix, node, ancestors = _source_node(tid, relative)
    required = {s['path'] for s in build_state.sections(tid)}
    allowed_nodes = [n for n in [*ancestors, *body_contract._iter_nodes([node])]
                     if prefix + body_contract.sanitize_name(n['目录名称']) + '.docx' in required]
    original = source.read_bytes()
    digest = hashlib.sha256(original).hexdigest()
    src = Document(BytesIO(original))
    blocks = _blocks(src)
    if not assignments_json:
        view = [{'block': i, 'kind': e.tag.rsplit('}', 1)[-1],
                 'text': ''.join(t.text or '' for t in e.iter(qn('w:t')))[:240]} for i, e in enumerate(blocks, 1)]
        return json.dumps({'source': relative, 'sha256': digest, 'block_count': len(blocks),
                           'allowed_titles': [n['目录名称'] for n in allowed_nodes], 'blocks': view}, ensure_ascii=False)
    if not expected_sha256 or expected_sha256 != digest:
        raise ValueError('原正文已变化或缺少expected_sha256，请重读块视图后再归集；未改动文件')
    try:
        assignments = json.loads(assignments_json)
    except ValueError as e:
        raise ValueError('assignments_json须为合法JSON数组') from e
    if not isinstance(assignments, list) or not assignments:
        raise ValueError('须明确每个正文块的归属，不能空分配')
    allowed = Counter(n['目录名称'] for n in allowed_nodes)
    routed, coverage = {}, []
    for item in assignments:
        if not isinstance(item, dict) or set(item) != {'title', 'ranges'}:
            raise ValueError('每项只含title与ranges')
        title = item['title']
        if not isinstance(title, str) or allowed[title] != 1:
            raise ValueError('目标必须唯一对应同册原章节、子孙或有独立正文的祖先，不能转入兄弟节或其他册：' + str(title))
        target, target_rel = _dest_path(tid, prefix + body_contract.sanitize_name(title) + '.docx', must_exist=False)
        if target_rel in routed or (target != source and target.exists()):
            raise ValueError('目标已有正文或清洗后重名，不能覆盖或重复分配：' + target_rel)
        ranges = item['ranges']
        if not isinstance(ranges, list) or not ranges:
            raise ValueError('目标须有实际原文块，不能创建空标题凑齐子节')
        indices = []
        for pair in ranges:
            if not isinstance(pair, list) or len(pair) != 2 or any(type(n) is not int for n in pair) or not 1 <= pair[0] <= pair[1] <= len(blocks):
                raise ValueError('块区间须为有效的闭区间整数[B起,B止]')
            indices.extend(range(pair[0], pair[1] + 1))
        coverage.extend(indices)
        routed[target_rel] = (target, sorted(indices))
    if Counter(coverage) != Counter(range(1, len(blocks) + 1)):
        raise ValueError('归集须覆盖全部原文块且每块恰好一次；存在遗漏或重复，未改动任何文件')
    owners = {i: rel for rel, (_, indices) in routed.items() for i in indices}
    opened, fields = {}, []
    for i, block in enumerate(blocks, 1):
        for e in block.iter():
            local = e.tag.rsplit('}', 1)[-1]
            if local in ('commentRangeStart', 'bookmarkStart'):
                opened[(local.replace('Start', ''), e.get(qn('w:id')))] = i
            elif local in ('commentRangeEnd', 'bookmarkEnd'):
                start = opened.pop((local.replace('End', ''), e.get(qn('w:id'))), i)
                if len({owners[n] for n in range(start, i + 1)}) != 1:
                    raise ValueError('不能跨目标拆开批注或书签范围，请将相关完整范围归入同一章节')
            elif local == 'fldChar':
                kind = e.get(qn('w:fldCharType'))
                if kind == 'begin':
                    fields.append(i)
                elif kind == 'end' and fields:
                    start = fields.pop()
                    if len({owners[n] for n in range(start, i + 1)}) != 1:
                        raise ValueError('不能跨目标拆开Word域，请将完整域归入同一章节')
    # 各输出从完整源包载入，只裁剪body元素；样式、图片、批注、链接关系都沿用源包。
    # 不通过文本重建，表格合并/图片/修订与关系ID不改变。
    staged = {}
    for rel, (target, indices) in routed.items():
        doc = Document(BytesIO(original))
        selected = set(indices)
        for index, element in enumerate(_blocks(doc), 1):
            if index not in selected:
                element.getparent().remove(element)
        staged[rel] = doc
    original_xml = Counter(etree.tostring(e) for e in blocks)
    if Counter(etree.tostring(e) for doc in staged.values() for e in _blocks(doc)) != original_xml:
        raise ValueError('正文块保全自检失败，未改动任何文件')
    with artifact_store.write_lock(), ExitStack() as locks:
        for p in sorted({source, *(v[0] for v in routed.values())}):
            locks.enter_context(_docx_path_lock(p))
        if hashlib.sha256(source.read_bytes()).hexdigest() != digest:
            raise ValueError('原文在归集期间已变化，未改动文件')
        if any(target != source and target.exists() for target, _ in routed.values()):
            raise ValueError('归集目标已由其他操作创建，未改动文件')
        backups = source.with_name(source.name + '.restorepoints')
        backups.mkdir(parents=True, exist_ok=True)
        backup = backups / (digest + '.bak')
        if not backup.exists():
            backup.write_bytes(original)
        written = []
        before_state = deepcopy(build_state.read(tid))
        try:
            for rel, doc in staged.items():
                target = routed[rel][0]
                target.parent.mkdir(parents=True, exist_ok=True)
                _atomic_save(doc, target)
                written.append(target)
            if relative not in routed:
                source.unlink()
                value = build_state.read(tid)
                value.get('sections', {}).pop(relative, None)
                value.get('pending_sections', {}).pop(relative, None)
                build_state.save(tid, value)
            value = build_state.read(tid)
            for key in ('asset_dependencies', 'source_dependencies'):
                dependencies = before_state.get(key, {}).get(relative)
                if dependencies:
                    for rel in staged:
                        value.setdefault(key, {})[rel] = deepcopy(dependencies)
            build_state.save(tid, value)
            for rel in staged:
                section = next(s for s in build_state.sections(tid) if s['path'] == rel)
                build_state._record_write_locked(tid, section, build_state.read(tid), current.conversation_id)
        except Exception:
            for target in written:
                if target != source:
                    target.unlink(missing_ok=True)
            source.write_bytes(original)
            build_state.save(tid, before_state)
            raise
    return json.dumps({'ok': True, 'source_sha256': digest, 'preserved_blocks': len(blocks),
                       'restore_point': str(backup.relative_to(artifact_store.work_dir(tid))),
                       'outputs': [{'path': rel, 'blocks': indices} for rel, (_, indices) in routed.items()],
                       'next': '逐个validate_body校验输出后再合册；尚未校验的输出保持draft'}, ensure_ascii=False)
