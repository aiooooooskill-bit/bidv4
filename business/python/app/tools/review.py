import json
from .. import runctx
from ..services import review

def save_review_report(report_json: str) -> dict:
    """保存招标/投标逐项对照报告，核验文件版本、证据角色、原文摘录及真实行号。

    report_json 为 JSON：summary；requirements[{id,category,text,status,tender:[{document_id,start,end,quote}],bid:[同结构]}]；issues[{id,requirement_id,severity,title,explanation,suggestion}]；coverage[{category,note}]；limitations[string]。
    category 六类：废标条款、资格要求、格式与结构、评分标准、商务要求、技术要求；coverage 每类一项，无相关要求也说明实际阅读范围。
    status: responded/missing/uncertain/conflict；severity: high/medium/low。摘录必须是对应解析稿真实原文，不编造页码、定位或结论。missing 可以无bid证据，其他状态必须有bid证据；非responded要求必须有对应问题。
    仅保存本次报告，完成执行后系统确认报告有效才标记已审核。
    """
    ctx = runctx.current_run()
    return review.save_report(ctx.task_id, ctx.conversation_id, json.loads(report_json))
