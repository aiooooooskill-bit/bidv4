"""承诺清单表格的统一读取；保留无效行供就绪校验和中间文件修复。"""
from typing import NamedTuple
from .markdown import iter_tables


class PromiseRow(NamedTuple):
    line: int
    item: str
    value: str
    note: str


def promise_rows(content):
    rows = []
    found = False
    for _, header, body in iter_tables(content):
        if '事项' in header and '值' in header:
            found = True
            for line, cells in body:
                rows.append(PromiseRow(line, cells[header.index('事项')], cells[header.index('值')],
                                       cells[header.index('说明')] if '说明' in header else ''))
    return rows, found


def unconfirmed(value):
    """值列的既有缺口状态；说明栏不能把缺口改为确认值。"""
    return (not value or ''.join(value.split()) in ('—', '-', '待补', '待确认', '待澄清', '未定', '未提供', '未确定')
            or value.startswith(('【缺', '【待补', '【待澄清', '【待确认')))
