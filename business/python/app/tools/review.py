from typing import Literal
from .. import runctx
from ..services import review, review_batches
from ..services.review_batches import Comparison

def review_basis(stage: Literal['read', 'validate'] = 'read') -> dict:
    """读取前序解读、共享证据规则及八份要点路径；validate校验完整招标要点。通过后用review_batch逐批核查。"""
    result = review.review_basis(runctx.current_run().task_id, stage == 'validate')
    if stage == 'validate':
        return {k: v for k, v in result.items() if k != 'catalog'} | {'requirements': len(result['catalog'])}
    return result

def review_batch() -> dict:
    """获取本轮下一批最多8项要求及程序生成的招标原文引用。每项用slot定位，问题写在该项problems内。完整核查该批后保存，再继续下一批。"""
    ctx = runctx.current_run()
    return review_batches.next_batch(ctx.task_id, ctx.conversation_id)

def save_review_batch(batch_id: str, results: list[Comparison]) -> dict:
    """提交本轮审核当前批次所有slot，或在本轮结束前用原batch_id更正已保存批次（仍须提交该批全部slot）。每项提供status、assessment、tender和bid证据、problems数组（无问题则[]）。问题无需id或requirement_id，系统沿用slot的要求，经程序校验后保存，不发起第二轮模型复审。
    tender须覆盖本条所有原要点引用；回读到相关条款、例外或冲突时扩展或补充实际招标引用，不能只在说明中提到而漏入证据卡。tender/bid只传document_id/start/end，摘录由程序取原文，不自动扩大行号。
    assessment说明取证和判断；缺失须反查全文相关章节，图片/真实性未知为uncertain。说明中不写L行号/页号，由页面证据卡生成。只提交本批，每个slot恰好一次。
    """
    ctx = runctx.current_run()
    return review_batches.candidate(ctx.task_id, ctx.conversation_id, batch_id, results)

def finish_review_report(summary: str, limitations: list[str]) -> dict:
    """本轮全部批次已保存后汇总报告。只提交简要summary和实际limitations；逐项对照和问题由已保存批次合成，不重复传整份清单。"""
    ctx = runctx.current_run()
    return review_batches.finalize(ctx.task_id, ctx.conversation_id, summary, limitations)
