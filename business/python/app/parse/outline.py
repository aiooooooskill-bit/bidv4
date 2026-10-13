"""带行号区间的标题大纲（使用统一 Markdown 解析器）。"""

from __future__ import annotations

from ..markdown import headings as markdown_headings


def outline_with_lines(md_text: str) -> list[dict]:
    """标题树，每个节点带 start_line/end_line（1 起行号，含）。

    节点区段 = 本标题行到下一个 level<=自身 的标题行之前；末节点到文件尾。
    """
    lines = md_text.splitlines()
    headings = [(h.line, h.level, h.title) for h in markdown_headings(md_text)]
    total = len(lines)
    root: list[dict] = []
    stack: list[tuple[int, list[dict]]] = [(-1, root)]
    for idx, (ln, lvl, title) in enumerate(headings):
        end = total
        for ln2, lvl2, _ in headings[idx + 1:]:
            if lvl2 <= lvl:
                end = ln2 - 1
                break
        node = {"标题": title, "level": lvl, "start_line": ln, "end_line": end, "children": []}
        while stack and stack[-1][0] >= lvl:
            stack.pop()
        stack[-1][1].append(node)
        stack.append((lvl, node["children"]))
    return root


def count_nodes(tree: list[dict]) -> int:
    return sum(1 + count_nodes(n.get("children", [])) for n in tree)
