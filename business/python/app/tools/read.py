"""按契约读取当前成果内容（后续阶段消费入口，artifact-system-design.md §9）。

2026-08-31 重构：产物归任务、单一真源，不再有「正式稿 → 过程稿」两级读序——
同契约在任务内唯一，读到的就是唯一当前内容。2026-09-04 两态移除：无草稿/已确认
之分。用户手动调整保存后，任何会话的后续阶段都应通过本工具按契约读取"当前内容"，
而不是依赖文件路径——这是"改完的成果成为后续 AI 输入"的闭环点。
"""
import json
from typing import Literal
from .. import artifact_store, contracts, db, runctx

def _task_id() -> str | None:
    """当前 run 的 task_id。不在 run 中或会话未归属任务时为 None。"""
    ctx = runctx.current_run()
    if ctx is None:
        return None
    return ctx.task_id

def _row_by_id(aid: str, kind: str) -> dict | None:
    row = db.get_artifact_index(aid)
    if row is None or row['kind'] != kind or (not artifact_store.package_ready(aid, row)):
        return None
    return row

def _list_in_task(kind: str, task_id: str | None) -> list[dict]:
    """当前任务内该 kind 的全部成果（task-multi 选择用）。"""
    if not task_id:
        return []
    rows = db.list_artifact_index(task_id=task_id)
    return [r for r in rows if r['kind'] == kind and artifact_store.package_ready(r['artifact_id'], r)]

def read_artifact(contract: str, artifact_id: str = '',
                  view: Literal['index', 'section', 'sources', 'full'] = 'index',
                  volume: str = '', section_path: list[str] | None = None,
                  source_ids: list[str] | None = None, content_seq: int | None = None) -> str:
    """按契约读取当前成果，默认index仅返回版本、范围与目录索引，不返回全部来源原文。

    后续分析/编写阶段需要引用结构化成果（如投标目录）时必须使用本工具，
    不要猜测文件路径。contract 如：tender.directory/tender-response-docs@1

    目录section视图填volume和section_path（从一级开始的完整标题数组），返回该节点及子树、引用的完整来源条目；只需某些依据时sources视图填1至8个source_ids。
    content_seq可填index返回的版本；版本变化报错，须重新读取index，不能使用旧依据。
    已在当前上下文且版本相同的所需内容直接复用；内容已被压缩移出时按范围重读。只有确需全局完整JSON时显式view=full，不例行整读。
    非目录成果先index查看字段，再显式full取内容。同类成果有多份时用artifact_id指定。
    """
    c = contracts.get_contract(contract)
    if c is None:
        keys = ', '.join(sorted(contracts.CONTRACTS))
        return f'[读取失败] 未注册的契约「{contract}」，可用：{keys}'
    task_id = _task_id()
    if artifact_id:
        row = _row_by_id(artifact_id.strip(), c.kind)
        if row is None:
            return f'[读取失败] 「{artifact_id}」不是可读取的「{c.default_display_name}」成果'
        if row.get('task_id') != task_id:
            return f'[读取失败] 「{artifact_id}」不在当前任务的可读范围内'
    elif c.cardinality != 'task-single':
        rows = _list_in_task(c.kind, task_id)
        if not rows:
            return f'[无成果] 当前还没有「{c.default_display_name}」（{contract}）；请先运行相应流程生成。'
        row = rows[0]
        if len(rows) > 1:
            listing = '\n'.join((f"- {r['artifact_id']}  {r['display_name']}" for r in rows))
            return f'[多份成果] 「{c.default_display_name}」有 {len(rows)} 份，请用 artifact_id 指定：\n{listing}'
    else:
        if not task_id:
            return f'[无成果] 当前还没有「{c.default_display_name}」（{contract}）；请先运行相应流程生成。'
        row = db.find_artifact_index(c.kind, c.schema_id, c.schema_version, task_id=task_id)
        if row is None or not artifact_store.package_ready(row['artifact_id'], row):
            return f'[无成果] 当前还没有「{c.default_display_name}」（{contract}）；请先运行相应流程生成。'
    # Use the same short lock as artifact publication/manual saves so the
    # advertised version and the selected content describe one snapshot.
    with artifact_store.write_lock():
        row = db.get_artifact_index(row['artifact_id'])
        if row is None or row.get('task_id') != task_id or row['kind'] != c.kind:
            return '[读取失败] 成果归属或类型已变化，请重新读取当前任务成果'
        if content_seq is not None and content_seq != row['content_seq']:
            return '[读取失败] 成果版本已变化，请重新读取index，不能沿用旧版本依据'
        raw = artifact_store.read_content_resolved(row['artifact_id'], row)
    if raw is None:
        return '[读取失败] 成果文件读取失败，请稍后重试'
    try:
        content = json.loads(raw)
    except ValueError:
        return '[读取失败] 成果内容不是合法 JSON，可能已被外部破坏'
    try:
        if view not in ('index', 'section', 'sources', 'full'):
            raise ValueError('未知读取视图')
        if view in ('index', 'full') and (volume or section_path or source_ids):
            raise ValueError('index/full不接受范围参数')
        if view == 'full':
            return raw
        result = {'artifact_id': row['artifact_id'], 'content_seq': row['content_seq'], 'view': view}
        if c.kind != 'tender.directory':
            if view != 'index':
                raise ValueError('此成果只支持index/full')
            result['fields'] = list(content) if isinstance(content, dict) else []
        else:
            result.update(_directory_view(content, view, volume, section_path, source_ids))
        return json.dumps(result, ensure_ascii=False, separators=(',', ':'))
    except ValueError as error:
        return '[读取失败] ' + str(error)


def _directory_view(content, view, volume, section_path, source_ids):
    docs, registry = content['response_documents'], content.get('registry', {})
    def nodes(tree, parents=()):
        for node in tree:
            path = (*parents, node['目录名称'])
            yield path, node
            yield from nodes(node.get('children', []), path)
    if view == 'index':
        return {'meta': content.get('meta', {}), 'numbering': content.get('numbering'),
                'page_target': content.get('page_target'), 'source_count': len(registry),
                'response_documents': [dict(name=d['name'], scope=d.get('scope', ''),
                    sections=[{'path': list(p), 'delivery': n.get('交付形态', '')} for p, n in nodes(d.get('directory', []))]) for d in docs]}
    if view == 'sources':
        if volume or section_path or not source_ids or len(source_ids) > 8 or len(set(source_ids)) != len(source_ids):
            raise ValueError('sources须提供1至8个不重复source_ids，不填volume/section_path')
        unknown = set(source_ids) - set(registry)
        if unknown:
            raise ValueError('不存在的来源：' + ','.join(sorted(unknown)))
        return {'registry': {rid: registry[rid] for rid in source_ids}}
    if source_ids or not volume or not section_path:
        raise ValueError('section须提供volume和从一级开始的section_path，不填source_ids')
    matches = [n for d in docs if d['name'] == volume for p, n in nodes(d.get('directory', [])) if list(p) == section_path]
    if len(matches) != 1:
        raise ValueError('目录路径不存在或不唯一，请从当前index选择完整路径')
    node = matches[0]
    ancestors = [{k: v for k, v in n.items() if k != 'children'}
                 for d in docs if d['name'] == volume for p, n in nodes(d.get('directory', []))
                 if len(p) < len(section_path) and list(p) == section_path[:len(p)]]
    ids = {rid for n in [*ancestors, *[n for _, n in nodes([node])]]
           for k in ('来源位置', '理由来源') for rid in n.get(k, [])}
    unknown = ids - set(registry)
    if unknown:
        raise ValueError('目录引用来源缺失：' + ','.join(sorted(unknown)))
    return {'meta': content.get('meta', {}), 'page_target': content.get('page_target'), 'numbering': content.get('numbering'),
            'volume': volume, 'scope': next(d.get('scope', '') for d in docs if d['name'] == volume),
            'section_path': section_path, 'ancestors': ancestors, 'node': node,
            'registry': {rid: registry[rid] for rid in sorted(ids)}}
