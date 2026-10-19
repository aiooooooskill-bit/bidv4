"""Word/WPS 原生多级标题编号；显示前缀仅用于目录缓存，不写入标题正文。"""
from docx.oxml import OxmlElement
from docx.oxml.ns import qn


def child(parent, tag, **attributes):
    element = OxmlElement('w:' + tag)
    for name, value in attributes.items():
        element.set(qn('w:' + name), str(value))
    parent.append(element)
    return element


def assign(paragraph, num_id, level):
    properties = paragraph.get_or_add_pPr()
    old = properties.find(qn('w:numPr'))
    if old is not None:
        properties.remove(old)
    numbering = properties.get_or_add_numPr()
    child(numbering, 'ilvl', val=level - 1)
    child(numbering, 'numId', val=num_id)


def chinese(value):
    if not 1 <= value <= 99:
        return str(value)
    digits = '零一二三四五六七八九'
    if value < 10:
        return digits[value]
    tens, ones = divmod(value, 10)
    return ('十' if tens == 1 else digits[tens] + '十') + (digits[ones] if ones else '')


class HeadingNumbering:
    def __init__(self, document, scheme):
        if scheme not in ('decimal', 'chapter', 'gov', 'none'):
            raise ValueError('未知标题编号格式：' + scheme)
        self.document = document
        self.scheme = scheme
        self.counters = [0] * 10
        self.root = document.part.numbering_part.element
        self.abstract_id = max([int(e.get(qn('w:abstractNumId'))) for e in self.root.findall(qn('w:abstractNum'))] + [-1]) + 1
        abstract = OxmlElement('w:abstractNum')
        abstract.set(qn('w:abstractNumId'), str(self.abstract_id))
        child(abstract, 'multiLevelType', val='multilevel')
        for level in range(1, 10):
            item = child(abstract, 'lvl', ilvl=level - 1)
            child(item, 'start', val=1)
            fmt = 'chineseCounting' if (scheme == 'chapter' and level == 1) or (scheme == 'gov' and level <= 2) else 'decimal'
            child(item, 'numFmt', val=fmt)
            child(item, 'pStyle', val=document.styles[f'Heading {level}'].style_id)
            if scheme == 'chapter' and level > 1:
                child(item, 'isLgl')  # 中文章号在 1.1 等组合编号中显示阿拉伯数字。
            child(item, 'suff', val='space' if scheme != 'gov' else 'nothing')
            text = '.'.join('%' + str(n) for n in range(1, level + 1))
            if scheme == 'chapter' and level == 1:
                text = '第%1章'
            if scheme == 'gov':
                text = {1: '%1、', 2: '（%2）', 4: '（%4）'}.get(level, '%' + str(level) + '.')
            child(item, 'lvlText', val=text)
            child(item, 'lvlJc', val='left')
            child(child(item, 'pPr'), 'ind', left=0, hanging=0)
        first_num = self.root.find(qn('w:num'))
        if first_num is None:
            self.root.append(abstract)
        else:
            first_num.addprevious(abstract)
        self.num_id = max([int(e.get(qn('w:numId'))) for e in self.root.findall(qn('w:num'))] + [0]) + 1
        item = child(self.root, 'num', numId=self.num_id)
        child(item, 'abstractNumId', val=self.abstract_id)
        for level in range(1, 10):
            assign(document.styles[f'Heading {level}'].element, self.num_id if scheme != 'none' else 0, level)

    def heading(self, paragraph, depth):
        for index in range(1, depth):
            self.counters[index] = self.counters[index] or 1
        self.counters[depth] += 1
        for index in range(depth + 1, 10):
            self.counters[index] = 0
        assign(paragraph, self.num_id if self.scheme != 'none' else 0, depth)
        if self.scheme == 'none':
            return ''
        if self.scheme == 'gov':
            if depth == 1:
                return chinese(self.counters[1]) + '、'
            if depth == 2:
                return '（' + chinese(self.counters[2]) + '）'
            return str(self.counters[depth]) + '.'
        if self.scheme == 'chapter' and depth == 1:
            return '第' + chinese(self.counters[1]) + '章 '
        return '.'.join(str(self.counters[index]) for index in range(1, depth + 1)) + ' '

    def subheads(self, elements, depth, self_numbered):
        """所有参与编号的标题共享原生列表，上级增删时子级随正文实际位置改变。"""
        style_levels = {self.document.styles[f'Heading {level}'].style_id: level for level in range(1, 10)}
        for element in elements:
            paragraphs = ([element] if element.tag == qn('w:p') else []) + element.findall('.//' + qn('w:p'))
            for paragraph in paragraphs:
                style = paragraph.find('./' + qn('w:pPr') + '/' + qn('w:pStyle'))
                level = style_levels.get(style.get(qn('w:val'))) if style is not None else None
                if level is None:
                    continue
                text = ''.join(t.text or '' for t in paragraph.iter(qn('w:t'))).strip()
                if self.scheme == 'none' or depth < 2 or level not in (3, 4) or self_numbered.match(text):
                    assign(paragraph, 0, level)
                    continue
                self.heading(paragraph, level)
