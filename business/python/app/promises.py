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
