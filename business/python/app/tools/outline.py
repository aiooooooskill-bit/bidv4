from typing import Literal
import json
from .. import runctx
from ..services.outline_contract import PlanBatch, plan_batch, check, _load


def outline_plan(operation: Literal['begin', 'decide', 'bind', 'replace_source', 'exclude', 'content_heading', 'complete'] = 'begin',
                 volume: str = '', root_titles: str = '', unit_id: str = '',
                 kind: Literal['', 'heading', 'detail', 'rubric', 'proof', 'procedure', 'out_of_scope'] = '',
                 reason: str = '', source_id: str = '', level1: str = '', level2: str = '', level3: str = '',
                 body_path: str = '', block: int = 0) -> dict:
    """逐项记录真实目录的分类与来源，保全原结构，全部审查后冻结。

    参数全部为直接标量，不传JSON字符串或嵌套数组。路径用level1/level2/level3各填本项目完整标题，不能跳级。
    begin：已有目录不传其他参数即承接原骨架；新目录填volume和root_titles（一级标题按原顺序换行分隔），各册分别begin。
    有SCORE时单册/多册均须真实task子代理独立评分对齐后再decide；不能由主代理预判跳过。
    decide：unit_id填context必审片段编号，kind选heading/detail/rubric/proof/procedure/out_of_scope，reason至少12字，volume及三级标题字段给出真实承载路径。
    独立实质分类选heading；类别中有参数/字段/举例不改变其独立性。无评分、其他部分未读到或正文尚缺，不能省略格式条款及用户明确要求的适用方案类别。
    明确数值/阈值/时长等才是detail，分档是rubric，证明是proof；不能以综合章概述或偏离表已覆盖代替独立标题。
    同一片段需多个标题/承载路径时，可重复decide追加目标，kind及原reason逐字保留；不能删旧目标或改判。
    bind：用source_id、volume和标题路径挂接普通来源。新增标题须先decide为heading，bindings不能暗中增加参数/证明标题。
    replace_source：回读registry证实旧ID错标后，填source_id及一个正确路径，清除其旧挂接并重建；原节点/说明保留，其余正确路径继续bind。
    回执source_changes_to_review列真实子稿移除的原来源；必须在complete前核对。旧错标纠正计划，旧有效来源重派恢复，不能将错标先冻结再补救。
    exclude：仅对本项目明确不适用或程序性无需成章的完整来源，source_id及reason说明原因；该来源的out_of_scope决策才可不填目标。
    content_heading：根据context.body_inventory的既有正文，填volume、标题路径、body_path、block和reason；末级标题须与实际原文标题逐字一致。只归入同册原章，不把素材当招标强制事实。
    每次最多同轮提交6个工具调用，读回执后再继续。pending_sources/pending_units都清零后complete冻结，check_outline回读真实标题并assemble_tender发布。
    冻结后不能改分类/标题/旧映射；仅bind向已批准路径追加经registry核实的合法来源，不能为消除报错增加不相关来源。
    """
    tid = runctx.current_run().task_id
    try:
        path = [s for s in (level1, level2, level3) if s]
        if (level3 and not level2) or (level2 and not level1):
            raise ValueError('标题路径不能跳级')
        batch = {}
        if operation not in ('begin', 'decide', 'bind', 'replace_source', 'exclude', 'content_heading', 'complete'):
            raise ValueError('未知目录审查操作')
        if root_titles:
            if not isinstance(root_titles, str):
                raise ValueError('root_titles直接填换行分隔的文本，不传数组')
            batch['volumes'] = [{'name': volume, 'root_titles': [s.strip() for s in root_titles.splitlines() if s.strip()]}]
        if operation in ('bind', 'replace_source', 'content_heading'):
            patch = {'name': volume}
            if operation == 'content_heading':
                patch['content_headings'] = [{'path': path, 'body_path': body_path, 'block': block, 'reason': reason}]
            else:
                patch['bindings'] = [{'source_id': source_id, 'path': path}]
            batch['volumes'] = [patch]
        if operation == 'replace_source':
            batch['replace_sources'] = [source_id]
        if operation == 'exclude':
            batch.update(replace_sources=[source_id], exclusions=[{'source_id': source_id, 'reason': reason}])
        if operation == 'decide':
            row = {'unit_id': unit_id, 'kind': kind, 'reason': reason,
                   'targets': [{'volume': volume, 'path': path}] if volume else []}
            value = _load(tid)
            old = next((d for d in (value.get('draft_plan') or {}).get('decisions', []) if d['unit_id'] == unit_id), None)
            if old:
                if old['kind'] != kind or old['reason'] != reason:
                    raise ValueError('已确认的kind及reason须保留；只能追加同一片段的目标路径')
                row['targets'] = old['targets'] + [t for t in row['targets'] if t not in old['targets']]
            batch['decisions'] = [row]
        if operation == 'complete':
            batch['complete'] = True
        return plan_batch(tid, PlanBatch.model_validate(batch))
    except ValueError as e:
        value = _load(tid)
        done = {d['unit_id'] for d in (value.get('draft_plan') or {}).get('decisions', [])}
        waiting_child = any(r.startswith('SCORE-') for r in value['registry']) and not value['aligned_volumes']
        pending = [] if waiting_child else [u for u,v in value['units'].items() if v['review_required'] and u not in done]
        errors = [{'field': '.'.join(map(str, x['loc'])), 'message': x['msg']} for x in e.errors(include_input=False, include_url=False)] if hasattr(e, 'errors') else str(e)
        raise ValueError('目录审查操作失败，未保存。' + json.dumps({'errors': errors, 'next_decision_unit_ids': pending[:6], 'remaining_decision_count': len(pending), 'next_action': '先begin承接骨架，再task独立评分对齐' if waiting_child else '先按errors点名问题修正；尚有待审片段才用decide。旧错标用replace_source核正全部正确路径，普通来源用bind；不重复complete跳过错误'}, ensure_ascii=False) + '。全部参数直接填写，不传JSON字符串或嵌套数组；不能因报错下调分类或删除原内容。') from e


def check_outline(volume: str = '') -> dict:
    """回读真实目录，核对冻结分类路径/来源、原节点/顺序/附件层级和原说明保留。

    volume留空检查全部；多册有错误只重派受影响册，不能主线程改写该册或改计划降标准。
    通过本检查仍须合并后assemble_tender；发布会再次核对，之后改文件不会沿用旧通过结果。
    """
    try:
        return check(runctx.current_run().task_id, volume)
    except ValueError as e:
        raise ValueError(str(e) + '。本次检查失败，不能继续发布；请按已冻结路径仅修正受影响册后重验。') from e
