from typing import Literal
from .. import runctx
from ..services import review, review_batches
from ..services.review_batches import Comparison
from ..services.review_schema import PlainItem

def review_basis(stage: Literal['read', 'validate'] = 'read') -> dict:
    """读取前序解读、共享证据规则及八份要点路径；validate校验完整招标要点。通过后用review_batch逐批核查。"""
    result = review.review_basis(runctx.current_run().task_id, stage == 'validate')
    if stage == 'validate':
        return {k: v for k, v in result.items() if k != 'catalog'} | {'requirements': len(result['catalog'])}
    return result

def review_batch(batch_id: str | None = None) -> dict:
    """不传batch_id获取本轮下一批最多8项要求、招标原文和本轮证据索引路径。先按大纲与grep回查完整投标文件，再合并本轮已取证材料。传本轮已保存batch_id可回读该批完整saved_results，供同一Agent在本轮内更正，不开启复审。"""
    ctx = runctx.current_run()
    return review_batches.next_batch(ctx.task_id, ctx.conversation_id, batch_id)

def save_review_batch(batch_id: str, results: list[Comparison]) -> dict:
    """提交本轮审核当前批次所有slot，或在本轮结束前用原batch_id更正已保存批次（仍须提交该批全部slot）。每项提供status、assessment、tender和bid证据、problems数组（无问题则[]）。问题无需id或requirement_id，系统沿用slot的要求，经程序校验后保存，不发起第二轮模型复审。
    tender须覆盖本条所有原要点引用；回读到相关条款、例外或冲突时扩展或补充实际招标引用，不能只在说明中提到而漏入证据卡。tender/bid只传document_id/start/end，摘录由程序取原文，不自动扩大行号。
    applicability为established或uncertain；条件/适用范围未明确时用uncertain，status同为uncertain，问题仅列confirmation。qualifications由程序保留本项全部招标原文（含范围、条件、例外），不用模型传入。bid_facts逐字摘录实际投标事实；各项为{evidence:{document_id,start,end},text:原文连续片段}，关联本项对应角色证据。已响应/冲突必须有bid_facts。程序保留限定原文，不由模型改写或丢弃。
    先列bid_facts再下结论；conflict须提交conflicts数组：{parameter,tender:{fact:{evidence,text},dimension},bid:{fact:{evidence,text},dimension}}，其它状态conflicts=[]。两侧必须实际原文、同一对象/条件/阶段、同一参数类型；time_window不能与effort互比。未找到/未重复不能作为conflict，须反查全文。analysis_locator只作定位线索，不能代替原文义务；据其导航回读相关范围与相邻完整条款，不自动扩展引用。applicability_reason须说明原文主体、对象、条件、时间阶段与本项目的对应证据，不凭“同为服务”“方向一致”证明适用。applicability未明确则不比较数值判冲突。保存回执shared_evidence列本轮共享原文的早期条目；立即核对原文，必要时回读更正受影响条目，然后继续next。assessment区分原文事实和判断；缺失先按大纲精读、逐词grep反查全文及证据索引。新证据影响早期条目，用review_batch(batch_id)回读并更正。图片/真实性未知为uncertain。不把未逐字重复当缺失、不把交付义务改成投标时必须提交成品。只提交本批，每个slot恰好一次。
    """
    ctx = runctx.current_run()
    return review_batches.candidate(ctx.task_id, ctx.conversation_id, batch_id, results)

def finish_review_report(limitations: list[PlainItem]) -> dict:
    """本轮全部批次已保存后汇总报告。只提交实际limitations（单行纯文本，不自带编号）；概要、分类数量、逐项对照和问题由程序从已保存批次合成，不重复传整份清单。"""
    ctx = runctx.current_run()
    return review_batches.finalize(ctx.task_id, ctx.conversation_id, limitations)
