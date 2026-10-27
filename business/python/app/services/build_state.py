"""制作依据与实际文件对账；保存正文，不通过删除文件处理目录变化。"""
import json
import re
from .. import artifact_store, db
from ..promises import promise_rows, unconfirmed
from . import page_flow
from . import bidder
from ..tools.body_contract import body_nodes_for_task, multi_volume, volume_key, sanitize_name, document_name, NON_PROSE_DELIVERY


def read(tid):
    path = artifact_store.work_dir(tid) / 'body/.build-state.json'
    return json.loads(path.read_text()) if path.is_file() else {}


def save(tid, value):
    artifact_store._atomic_write(artifact_store.work_dir(tid) / 'body/.build-state.json', json.dumps(value, ensure_ascii=False))


GUIDE_REFERENCE_RE = re.compile(r'(?<![A-Za-z0-9_])(?:MAND|REQ|TPL|SCORE|CLAR)-\d+(?![A-Za-z0-9_])', re.IGNORECASE)


def guide_reference_ids(content):
    from ..tools.assemble_tender import _norm_id
    return list(dict.fromkeys(_norm_id(match.upper()) for match in GUIDE_REFERENCE_RE.findall(content)))


def guide_registry(tid, content_hash=None):
    evidence = read(tid).get('guide_evidence')
    path = artifact_store.work_dir(tid) / 'body/写作指引.md'
    current_hash = content_hash if content_hash is not None else page_flow.file_hash(path) if path.is_file() else None
    return evidence['registry'] if evidence and evidence['hash'] == current_hash else None


def guide_reference_issues(tid, content, evidence_hash=None):
    from ..tools.validate_body import _parse_guide_rows
    registry = guide_registry(tid, evidence_hash)
    issues = []
    for line, cells, columns in _parse_guide_rows(content):
        index = columns.get('依据')
        raw = cells[index] if index is not None and index < len(cells) else ''
        missing = [ref for ref in guide_reference_ids(raw) if not str(((registry or {}).get(ref) or {}).get('text') or '').strip()]
        if missing:
            issues.append(f'写作指引.md:{line} 依据 {"、".join(missing)} 未关联到此版本指引的可信来源，请核对依据或重新生成指引')
    return issues


def sections(tid):
    directory = page_flow.directory(tid)
    if not directory:
        return []
    content = directory['content']
    result = []
    state = read(tid)
    owned = set(state.get('sections', {})) | set(state.get('pending_sections', {}))
    for vol, title, delivery in body_nodes_for_task(tid, content):
        path = 'body/' + (volume_key(vol) + '/' if multi_volume(content) else '') + sanitize_name(title) + '.docx'
        if title != '目录' and (delivery != '目录容器' or (artifact_store.work_dir(tid) / path).is_file() or path in owned):
            result.append({'volume': vol, 'title': title, 'path': path})
    return result


def section_basis(tid, section):
    content = page_flow.directory(tid)['content']
    def find(nodes, ancestors=()):
        for node in nodes:
            if node['目录名称'] == section['title']:
                return {'ancestors': ancestors, 'node': {k: v for k, v in node.items() if k not in ('level', '_id', 'children')}}
            if node.get('children'):
                found = find(node['children'], (*ancestors, node['目录名称']))
                if found:
                    return found
    doc = next(d for d in content['response_documents'] if document_name(d) == section['volume'])
    versions = page_flow.input_versions(tid)
    # 编号和树序只影响合册；正文依据按章节内容及共享规划比对。
    root = artifact_store.work_dir(tid)
    shared = {f: page_flow.file_hash(root / f) if (root / f).is_file() else None for f in ('body/写作指引.md', 'body/关键事实与承诺.md')}
    from .asset_usage import basis as asset_basis
    from .source_usage import basis as reference_basis
    return page_flow.digest({'references':reference_basis(tid,['guide','promises',section['path']]), 'assets':asset_basis(tid,['guide','promises',section['path']]), 'source_analysis': versions['outline'], 'planning': shared, 'bidder':bidder.basis(tid),
                             'page_target': content.get('page_target'), 'volume': section['volume'],
                             'scope': doc.get('scope'), 'node': find(doc.get('directory', []))})


def snapshot(tid):
    stored = read(tid)
    root = artifact_store.work_dir(tid)
    planning = {kind: 'missing' if not (root / path).is_file() else 'ready' if stored.get(kind) == preparation_stamp(tid, kind) else 'stale' if stored.get(kind) else 'missing'
                for kind, path in [('guide', 'body/写作指引.md'), ('promises', 'body/关键事实与承诺.md')]}
    guide_path = root / 'body/写作指引.md'
    reference_issues = guide_reference_issues(tid, guide_path.read_text()) if guide_path.is_file() else []
    if reference_issues and planning['guide'] == 'ready':
        planning['guide'] = 'stale'
    changes = {}
    labels = {'sources': '招标来源', 'analysis': '招标解读', 'directory': '目录内容或目标篇幅', 'guide': '写作指引', 'bidder':'投标主体或代表', 'assets':'已采用公司资料', 'references':'已采用参考来源'}
    for kind in ('guide', 'promises'):
        previous = stored.get(kind)
        current = preparation_stamp(tid, kind)
        changes[kind] = []
        if planning[kind] == 'stale':
            old_inputs = previous.get('inputs', {}) if isinstance(previous, dict) else {}
            changes[kind] = [label + '已变化' for key, label in labels.items() if key in current['inputs'] and old_inputs.get(key) != current['inputs'][key]]
            if isinstance(previous, dict) and previous.get('hash') != current['hash']:
                changes[kind].append('准备文件已修改，尚未通过校验')
            if kind == 'guide' and reference_issues:
                changes[kind].append('指引依据引用尚未核对')
            if not changes[kind]:
                changes[kind] = ['当前准备尚未校验并记录']
    items = []
    for section in sections(tid):
        exists = (root / section['path']).is_file()
        basis = stored.get('sections', {}).get(section['path'])
        pending = stored.get('pending_sections', {}).get(section['path'])
        status = 'missing' if not exists else 'draft' if pending else 'unverified' if not basis else 'ready' if basis == section_basis(tid, section) else 'stale'
        proof = stored.get('section_validations', {}).get(section['path'])
        validated_actions = (proof['action_ids'] if status == 'ready' and proof and proof['basis'] == basis
                            and proof['hash'] == page_flow.file_hash(root / section['path']) else [])
        items.append({**section, 'status': status, 'validated_action_ids': validated_actions,
                      'modified_at': (root / section['path']).stat().st_mtime_ns / 1_000_000 if exists else None})
    body_files = [p.relative_to(root).as_posix() for p in (root / 'body').rglob('*.docx') if not p.name.startswith('整本-')]
    expected = {s['path'] for s in items}
    return {'build_preparation': planning, 'build_preparation_changes': changes, 'body_sections': items,
            'orphan_body_files': sorted(set(body_files) - expected),
            'volume_states': volume_states(tid, stored)}


def preparation_stamp(tid, stage):
    root = artifact_store.work_dir(tid)
    path = root / ('body/写作指引.md' if stage == 'guide' else 'body/关键事实与承诺.md')
    directory = page_flow.directory(tid)
    content = directory['content'] if directory else {}
    from .bidder import basis
    from .asset_usage import basis as asset_basis
    from .source_usage import basis as reference_basis
    inputs = {
        'references':reference_basis(tid,['guide'] if stage=='guide' else ['guide','promises']),
        'assets':asset_basis(tid,['guide'] if stage=='guide' else ['guide','promises']),
        'bidder':page_flow.digest(basis(tid)),
        'sources': page_flow.analysis_source_version(tid),
        'analysis': page_flow.digest({f['path']: f['hash'] for f in page_flow.files(tid) if f['path'].startswith('analysis/')}),
        'directory': page_flow.digest({k: v for k, v in content.items() if k != 'numbering'}),
    }
    if stage == 'promises':
        guide = root / 'body/写作指引.md'
        inputs['guide'] = page_flow.file_hash(guide) if guide.is_file() else None
    return {'basis': page_flow.input_versions(tid)[stage], 'hash': page_flow.file_hash(path) if path.is_file() else None, 'inputs': inputs}


def promise_values(content):
    result = {}
    rows, found = promise_rows(content)
    for row in rows:
        if not row.item or not row.value:
            raise ValueError(f'承诺清单第{row.line}行：事项和值不能为空，缺列请补齐')
        if row.item in result:
            raise ValueError('承诺事项重复：' + row.item)
        result[row.item] = row.value
    return result, found


def check_preparation_write(tid, stage, content):
    if stage != 'promises':
        return
    proposed, _ = promise_values(content)
    path = artifact_store.work_dir(tid) / 'body/关键事实与承诺.md'
    if not path.is_file():
        validate_preparation(tid, stage, content)
        return
    previous, _ = promise_rows(path.read_text())
    normalized = lambda value: re.sub(r'\s+', '', value)
    differences = []
    for _, key, value, _ in previous:
        if not key:
            continue
        if unconfirmed(value):
            continue
        if normalized(proposed.get(key, '')) != normalized(value):
            differences.append(f'{key}：{value} → {proposed.get(key, "删除") or "空值"}')
    if differences:
        raise ValueError('已有承诺值需要用户处理，未写入：' + '；'.join(dict.fromkeys(differences)) + '。请在关键事实与承诺页签编辑并保存。')
    validate_preparation(tid, stage, content)


def validate_preparation(tid, stage, content, *, evidence_hash=None):
    if stage == 'guide':
        from ..tools.validate_body import _validate_guide
        issues, _, _ = _validate_guide(content, tid)
        issues.extend(guide_reference_issues(tid, content, evidence_hash))
        if issues:
            raise ValueError('写作指引校验未通过：' + '；'.join(issues))
    else:
        values, found = promise_values(content)
        if not found or not values or any(not value for value in values.values()):
            raise ValueError('承诺清单须包含事项、值的表格，事项和值不能为空')


def record_guide_write(tid, previous_hash, replace):
    """只在本次模型实际写入后绑定引用；读取或重新校验旧文件不能推断其来源。"""
    path = artifact_store.work_dir(tid) / 'body/写作指引.md'
    with artifact_store.write_lock():
        value = read(tid)
        current_hash = page_flow.file_hash(path)
        if current_hash == previous_hash:
            return
        evidence = value.get('guide_evidence')
        if replace:
            directory = page_flow.directory(tid)
            value['guide_evidence'] = {'hash': current_hash,
                                       'registry': directory['content'].get('registry', {}) if directory else {}}
        elif evidence and evidence['hash'] == previous_hash:
            evidence['hash'] = current_hash
        else:
            value.pop('guide_evidence', None)
        save(tid, value)


def record_preparation(tid, stage, session_id=None, *, evidence_hash=None):
    if stage not in ('guide', 'promises'):
        raise ValueError('规划阶段无效')
    path = artifact_store.work_dir(tid) / ('body/写作指引.md' if stage == 'guide' else 'body/关键事实与承诺.md')
    if not path.is_file() or not path.read_text().strip():
        raise ValueError('规划文件尚未生成')
    with artifact_store.write_lock():
        validate_preparation(tid, stage, path.read_text(), evidence_hash=evidence_hash)
        if stage == 'promises' and snapshot(tid)['build_preparation']['guide'] != 'ready':
            raise ValueError('请先完成并校验当前写作指引')
        value = read(tid)
        from .asset_usage import attach_reads
        try:
            attach_reads(tid,value,stage,session_id,replace=True)
        finally:
            save(tid,value)
        stamp = preparation_stamp(tid, stage)
        if stage == 'guide' and evidence_hash:
            evidence = value.get('guide_evidence')
            # 页面编辑延续其所读取版本的引用语义，不能给未知旧文件补猜新来源。
            if evidence and evidence['hash'] == evidence_hash:
                evidence['hash'] = stamp['hash']
        value[stage] = stamp
        save(tid, value)


def record_section(tid, path):
    section = next((s for s in sections(tid) if s['path'] == path), None)
    if section and (artifact_store.work_dir(tid) / path).is_file():
        with artifact_store.write_lock():
            value = read(tid)
            value.setdefault('sections', {})[path] = section_basis(tid, section)
            value.setdefault('pending_sections', {}).pop(path, None)
            save(tid, value)


def record_write(tid, path, session_id=None, replace=False):
    section = next((s for s in sections(tid) if s['path'] == path), None)
    if section:
        with artifact_store.write_lock():
            _record_write_locked(tid, section, read(tid), session_id, replace)


def _record_write_locked(tid, section, value, session_id=None, replace=False):
    """调用方已持发布锁；供单节写入与多节保全事务共用同一记账逻辑。"""
    path = section['path']
    if replace:
        value.get('section_titles', {}).pop(path, None)
    from .asset_usage import attach_reads
    try:
        attach_reads(tid, value, path, session_id, replace)
    except ValueError:
        value.setdefault('pending_sections', {})[path] = {'basis': None, 'hash': page_flow.file_hash(artifact_store.work_dir(tid) / path)}
        save(tid, value)
        raise
    save(tid, value)
    value.setdefault('pending_sections', {})[path] = {'basis': section_basis(tid, section), 'hash': page_flow.file_hash(artifact_store.work_dir(tid) / path)}
    save(tid, value)


def record_validation(tid, path):
    # 单纯读取/检查旧正文不能把过期依据自动盖成当前依据。
    section = next((s for s in sections(tid) if s['path'] == path), None)
    with artifact_store.write_lock():
        _record_validation_locked(tid, path, section)


def _record_validation_locked(tid, path, section):
    value = read(tid)
    pending = value.get('pending_sections', {}).get(path)
    if section and pending and pending['basis'] == section_basis(tid, section) and pending['hash'] == page_flow.file_hash(artifact_store.work_dir(tid) / path):
        value.setdefault('sections', {})[path] = pending['basis']
        value['pending_sections'].pop(path)
        save(tid, value)

def volume_basis(tid, doc):
    content = page_flow.directory(tid)['content']
    root = artifact_store.work_dir(tid)
    prefix = volume_key(document_name(doc)) + '/' if multi_volume(content) else ''
    paths = ['body/' + prefix + sanitize_name(title) + '.docx'
             for vol, title, _ in body_nodes_for_task(tid, content) if vol == document_name(doc)]
    paths += ['body/写作指引.md', 'body/关键事实与承诺.md']
    from .asset_usage import basis as asset_basis
    from .source_usage import basis as reference_basis
    from .document_format import inspect_rules
    return page_flow.digest({'references':reference_basis(tid,['guide','promises',*paths]), 'formatting':inspect_rules(tid), 'assets':asset_basis(tid,['guide','promises',*paths]), 'document': doc, 'numbering': content.get('numbering'),
                             'page_target': content.get('page_target'),
                             'source_analysis': page_flow.input_versions(tid)['outline'], 'bidder':bidder.basis(tid),
                             'files': {p: page_flow.file_hash(root / p) if (root / p).is_file() else None for p in paths}})


def volume_states(tid, stored):
    directory = page_flow.directory(tid)
    rows = {r['display_name']: r for r in db.list_artifact_index(task_id=tid) if r['kind'] == 'tender.volume'}
    result = []
    for doc in directory['content']['response_documents'] if directory else []:
        if not doc.get('directory'):
            continue
        name = document_name(doc)
        path = 'body/整本-' + volume_key(name) + '.docx'
        file = artifact_store.work_dir(tid) / path
        row = rows.get(name)
        stamp = stored.get('volumes', {}).get(row['artifact_id']) if row else None
        try:
            metadata = json.loads(artifact_store.read_content_resolved(row['artifact_id'],row) or '{}') if row else {}
        except ValueError:
            metadata = {}
        packaged_word = next((p for p in artifact_store.package_files(row['artifact_id'],row) if p.name==metadata.get('filename')),None) if row else None
        exists = file.is_file() and packaged_word is not None
        intact = exists and page_flow.file_hash(packaged_word)==metadata.get('sha256')
        prefix = volume_key(name) + '/' if multi_volume(directory['content']) else ''
        required = ['body/' + prefix + sanitize_name(title) + '.docx'
                    for vol, title, delivery in body_nodes_for_task(tid, directory['content']) if vol == name
                    if title != '目录' and delivery not in NON_PROSE_DELIVERY]
        complete = all((artifact_store.work_dir(tid) / p).is_file() and p not in stored.get('pending_sections', {}) for p in required)
        ready = intact and complete and stamp == {'basis': volume_basis(tid, doc), 'content_seq': row['content_seq'], 'hash': page_flow.file_hash(file)}
        result.append({'name': name, 'path': path, 'artifact_id': row['artifact_id'] if row else None,
                       'status': 'missing' if not exists else 'ready' if ready else 'stale'})
    return result


def record_volume(tid, name, artifact_id):
    doc = next(d for d in page_flow.directory(tid)['content']['response_documents'] if document_name(d) == name)
    row = next(r for r in db.list_artifact_index(task_id=tid) if r['artifact_id'] == artifact_id)
    path = artifact_store.work_dir(tid) / ('body/整本-' + volume_key(name) + '.docx')
    with artifact_store.write_lock():
        value = read(tid)
        value.setdefault('volumes', {})[artifact_id] = {'basis': volume_basis(tid, doc), 'content_seq': row['content_seq'], 'hash': page_flow.file_hash(path)}
        save(tid, value)
