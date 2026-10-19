"""保留评分/明确列举的完整语义片段；这里只切分，不替模型决定标题。"""
import re


def scheme_categories(text):
    """保留原文明确逐项命名的方案类别，不把普通参数/证明材料拆成标题。"""
    categories = []
    for piece in re.split(r'[（）()、，,/与及和]', text):
        match = re.search(r'([\u4e00-\u9fffA-Za-z0-9]+方案)', piece)
        if match:
            name = re.sub(r'^.*(?:包括但不限于|包括|分别说明|分别提供|分别编制|分别提交)', '', match[1])
            if name not in categories:
                categories.append(name)
    return categories if len(categories) >= 2 else []


def _outside_brackets(text):
    depth = 0
    outside = []
    for char in text:
        outside.append(depth == 0)
        if char in '（([【':
            depth += 1
        elif char in '）)]】':
            depth = max(0, depth - 1)
    return outside


def _pieces(text, *, requirement=False):
    outside = _outside_brackets(text)
    marks = [m for m in re.finditer(r'[①②③④⑤⑥⑦⑧⑨⑩]|(?<![\d.])\d{1,2}[.、 ]\s*(?=[\u4e00-\u9fff])', text) if outside[m.start()]]
    if len(marks) >= 2:
        # 首个编号前的约束也不能丢失。
        return [text[:marks[0].start()].strip(), *[text[m.end():marks[i+1].start() if i+1 < len(marks) else len(text)].strip() for i, m in enumerate(marks)]]
    separators = r'[；;]|以及|和|及|、|与' if requirement else r'[；;]'
    cuts = [m for m in re.finditer(separators, text) if outside[m.start()]]
    start, pieces = 0, []
    for match in cuts:
        pieces.append(text[start:match.start()].strip())
        start = match.end()
    pieces.append(text[start:].strip())
    return pieces


def decision_units(registry):
    result = {}
    for rid, entry in registry.items():
        required = rid.startswith('SCORE-')
        text = entry.get('评分要点', '') if required else entry['text']
        requirement = False
        if rid.startswith('REQ-'):
            match = re.search(r'分别(?:说明|提供|编制|编写|提交|阐述|制定)[：:]?(.+)', entry['text'])
            if match:
                text, requirement, required = match[1], True, True
        if not text:
            continue
        categories = scheme_categories(text) if rid.startswith(('MAND-', 'REQ-')) else []
        if categories:
            pieces, required = categories, True
        else:
            pieces = [piece for piece in _pieces(text, requirement=requirement) if piece] if required else [text]
        for i, piece in enumerate(pieces, 1):
            result[f'{rid}:{i}'] = {'source_id': rid, 'text': piece, 'review_required': required}
            if categories:
                result[f'{rid}:{i}']['review_context'] = '原文明确命名的方案类别；须综合格式、需求、用户要求及已有正文逐类核对，不只对齐评分。已明确适用时为独立标题；无评分、其他章节未读到、尚缺正文均不是省略理由。括号内条件须保留并核验，不能将整组一并忽略。原条款：' + text
    return result
