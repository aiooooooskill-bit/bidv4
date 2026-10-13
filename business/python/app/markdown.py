"""Markdown 结构的唯一解析入口；业务规则只消费 token，不再识别 Markdown 语法。"""
from typing import NamedTuple

from markdown_it import MarkdownIt
from markdown_it.token import Token

_parser = MarkdownIt('commonmark').enable(['table', 'strikethrough'])


def parse_markdown(content: str, *, source: str | None = None) -> list[Token]:
    # 业务按章节取片段时，引用式链接的定义仍可能在完整文件末尾。
    env = {}
    if source is not None:
        _parser.parse(source, env)
    return _parser.parse(content, env)


def inline_text(tokens: list[Token]) -> str:
    return ''.join(
        inline_text(token.children) if token.children else
        '\n' if token.type in ('softbreak', 'hardbreak') else
        token.content if token.type in ('text', 'code_inline') else ''
        for token in tokens
    )


class Heading(NamedTuple):
    line: int
    end_line: int
    level: int
    title: str


def headings(content: str, *, source: str | None = None) -> list[Heading]:
    tokens = parse_markdown(content, source=source)
    return [Heading(token.map[0] + 1, token.map[1], int(token.tag[1:]),
                    inline_text(tokens[i + 1].children or []).strip())
            for i, token in enumerate(tokens)
            if token.type == 'heading_open' and token.level == 0]


def sections(content: str, level: int, *, source: str | None = None):
    """按真实标题分段，正文保留原文与行号；遇到同级或更高级标题结束。"""
    lines = content.splitlines()
    titles = headings(content, source=source)
    for i, heading in enumerate(titles):
        if heading.level != level:
            continue
        end = next((h.line - 1 for h in titles[i + 1:] if h.level <= level), len(lines))
        yield heading, '\n'.join(lines[heading.end_line:end])


def iter_tables(content: str, *, source: str | None = None):
    """(表起始行, 表头, [(行号, 单元格)])；缺少尾列由解析器补空格。"""
    header = None
    body = []
    cells = None
    in_header = False
    start = line = 0
    for token in parse_markdown(content, source=source):
        if token.type == 'table_open':
            start = token.map[0] + 1
            header, body = None, []
        elif token.type == 'thead_open':
            in_header = True
        elif token.type == 'thead_close':
            in_header = False
        elif token.type == 'tr_open':
            cells = []
            line = token.map[0] + 1
        elif token.type == 'inline' and cells is not None:
            cells.append(inline_text(token.children or []).strip())
        elif token.type == 'tr_close':
            if in_header:
                header = cells
            else:
                body.append((line, cells))
            cells = None
        elif token.type == 'table_close':
            yield start, header, body


class ListItem(NamedTuple):
    line: int
    end_line: int
    depth: int
    ordered: bool
    text: str


def list_items(content: str, *, source: str | None = None) -> list[ListItem]:
    """列表项首段文本及语法树深度，排除引用块和代码块中的伪列表。"""
    lists = []
    items = []
    result = []
    quotes = 0
    for token in parse_markdown(content, source=source):
        if token.type == 'blockquote_open':
            quotes += 1
        elif token.type == 'blockquote_close':
            quotes -= 1
        elif token.type in ('bullet_list_open', 'ordered_list_open'):
            lists.append(token.type == 'ordered_list_open')
        elif token.type in ('bullet_list_close', 'ordered_list_close'):
            lists.pop()
        elif token.type == 'list_item_open':
            items.append(False)
        elif token.type == 'list_item_close':
            items.pop()
        elif token.type == 'inline' and items and not items[-1] and not quotes:
            items[-1] = True
            result.append(ListItem(token.map[0] + 1, token.map[1], len(lists), any(lists),
                                   inline_text(token.children or []).strip()))
    return result


def markdown_text(content: str, *, source: str | None = None) -> str:
    """用于文本比对/检索，剥除结构标记和 HTML 注释，保留代码正文。"""
    return '\n'.join(inline_text(token.children or []) if token.type == 'inline' else token.content
                     for token in parse_markdown(content, source=source)
                     if token.type in ('inline', 'fence', 'code_block'))
