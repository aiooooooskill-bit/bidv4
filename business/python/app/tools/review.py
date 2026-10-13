from .. import runctx
from ..services import review

def save_review_report(report: dict) -> dict:
    """保存结构化审查报告。report直接传JSON对象，不传编码后的JSON字符串。

    report包含：summary；requirements[{id,category,text,status,tender:[{document_id,start,end}],bid:[同结构]}]；issues[{id,requirement_id,severity,title,explanation,suggestion}]；coverage[{category,note}]；limitations[string]。
    category必须使用六类中文原名：废标条款、资格要求、格式与结构、评分标准、商务要求、技术要求；coverage每类一项。
    status为responded/missing/uncertain/conflict；severity为high/medium/low。
    证据只提供prepare_review_documents返回的真实document_id与真实行号start/end，引用支撑结论的最小行区间，勿传quote。系统按行号提取原文，模型不复制、拼接或改写摘录。
    responded与conflict必须有bid证据；missing与uncertain可无bid证据；missing与conflict必须有对应问题；外部核验的uncertain事项在limitations说明，不编造投标依据。
    文件版本、角色、行号和要求关联全部校验。完成执行后系统确认报告有效才标记已审核。
    """
    ctx = runctx.current_run()
    return review.save_report(ctx.task_id, ctx.conversation_id, report)
