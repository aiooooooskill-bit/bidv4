"""项目格式规则：用户缺省值 + 附有招标原文的明确覆盖；只改变派生合册。"""
import hashlib
import re
from copy import deepcopy
from docx.oxml import OxmlElement
from docx.oxml.ns import qn
from docx.shared import Pt
from docx.enum.text import WD_ALIGN_PARAGRAPH
from docx.enum.style import WD_STYLE_TYPE
from docx.text.paragraph import Paragraph
from ..artifact_store import work_dir
from . import build_state

DEFAULT_BODY = {'font': '宋体', 'font_size': 12.0, 'line_spacing': 1.5, 'spacing_rule': 'multiple'}


def preserve_cover(source,elements):
    """封面沿用原件有效格式，隔离新Normal样式的继承变化。"""
    for element in elements:
        for e in ([element] if element.tag==qn('w:p') else []) + element.findall('.//'+qn('w:p')):
            p=Paragraph(e,source._body)
            styles=[];style=p.style
            while style is not None:
                styles.append(style);style=style.base_style
            for attr in ('line_spacing','space_before','space_after','first_line_indent','left_indent','right_indent'):
                if getattr(p.paragraph_format,attr) is None:
                    value=next((getattr(s.paragraph_format,attr) for s in styles if getattr(s.paragraph_format,attr) is not None),None)
                    if value is not None:setattr(p.paragraph_format,attr,value)
            for run in p.runs:
                if run.font.size is None:
                    size=next((s.font.size for s in styles if s.font.size is not None),None)
                    if size is not None:run.font.size=size


def inspect_rules(tid):
    """读取规则及失效项供核对；失效项不会被当成可应用的默认值。"""
    stored = build_state.read(tid).get('document_format', {})
    result, issues, digests = {}, [], {}
    for target, properties in stored.items():
        result[target] = {}
        for name, rule in properties.items():
            path = work_dir(tid) / rule['evidence_path']
            if path not in digests:
                digests[path] = hashlib.sha256(path.read_bytes()).hexdigest() if path.is_file() else None
            if digests[path] != rule['evidence_sha256']:
                issues.append({'target': target, 'property': name, 'evidence_path': rule['evidence_path']})
            result[target][name] = rule['value']
    return {'status': 'stale' if issues else 'ready', 'rules': result, 'issues': issues}


def rules(tid):
    inspected = inspect_rules(tid)
    if inspected['issues']:
        raise ValueError('招标格式依据已变化，须重新核对格式规则：' + '、'.join(dict.fromkeys(i['evidence_path'] for i in inspected['issues'])))
    return inspected['rules']


def fonts(rpr, font, size):
    rf = rpr.find(qn('w:rFonts'))
    if rf is None:
        rf = OxmlElement('w:rFonts'); rpr.insert(0, rf)
    for name in list(rf.attrib):
        if name.endswith('Theme') or name.endswith('theme'):
            rf.attrib.pop(name)
    for name in ('ascii', 'hAnsi', 'eastAsia', 'cs'):
        rf.set(qn('w:'+name), font)
    for tag in ('sz', 'szCs'):
        e = rpr.find(qn('w:'+tag))
        if e is None:
            e = OxmlElement('w:'+tag); rpr.append(e)
        e.set(qn('w:val'), str(round(size*2)))


def black(rpr):
    color = rpr.find(qn('w:color'))
    if color is None:
        color = OxmlElement('w:color'); rpr.append(color)
    color.attrib.clear()
    color.set(qn('w:val'), '000000')


def paragraph(p, spec):
    ppr = p.get_or_add_pPr()
    spacing = ppr.find(qn('w:spacing'))
    if spacing is None:
        spacing = OxmlElement('w:spacing'); ppr.append(spacing)
    spacing.set(qn('w:line'), str(round(spec['line_spacing']*(240 if spec['spacing_rule']=='multiple' else 20))))
    spacing.set(qn('w:lineRule'), 'auto' if spec['spacing_rule']=='multiple' else 'exact')
    # 文档网格会覆盖倍数行距；原文字、缩进、对齐、图片与表格结构均不改。
    grid = ppr.find(qn('w:snapToGrid'))
    if grid is None:
        grid = OxmlElement('w:snapToGrid'); ppr.append(grid)
    grid.set(qn('w:val'),'0')
    for run in p.iter(qn('w:r')):
        fonts(run.get_or_add_rPr(), spec['font'], spec['font_size'])


def fit_table(element, available_twips):
    """合册版心变窄时等比收拢原表格；合并格、文字和行高不变。"""
    grid = element.find(qn('w:tblGrid'))
    if grid is None: return
    widths = [int(c.get(qn('w:w'), '0')) for c in grid]
    total = sum(widths)
    if total <= available_twips or total <= 0: return
    ratio = available_twips / total
    for column in grid:
        column.set(qn('w:w'), str(max(1,round(int(column.get(qn('w:w')))*ratio))))
    for node in element.iter():
        if node.tag in {qn('w:tcW'), qn('w:tblW'), qn('w:tblInd'), qn('w:wBefore'), qn('w:wAfter')} and node.get(qn('w:type'),'dxa') == 'dxa':
            value = node.get(qn('w:w'))
            if value is not None: node.set(qn('w:w'), str(round(int(value)*ratio)))
        elif node.tag == qn('w:gridCol') and node.getparent() is not grid:
            node.set(qn('w:w'),str(max(1,round(int(node.get(qn('w:w')))*ratio))))


def keep_table_rows(element, following=None):
    """用 Word 原生分页约束保全表行，短表头跟随首行，表格式图示跟随图注。"""
    rows = element.findall(qn('w:tr'))
    caption = ''.join(t.text or '' for t in following.iter(qn('w:t'))).strip() if following is not None and following.tag == qn('w:p') else ''
    diagram = bool(re.match(r'^[图表]\s*\d', caption)) and len(caption) <= 100 and len(rows) <= 20 and sum(len(t.text or '') for t in element.iter(qn('w:t'))) <= 1200
    for i, row in enumerate(rows):
        trpr = row.get_or_add_trPr()
        if trpr.find(qn('w:cantSplit')) is None:
            trpr.append(OxmlElement('w:cantSplit'))
        cells = row.findall(qn('w:tc'))
        first_cell = ''.join(t.text or '' for t in cells[0].iter(qn('w:t'))).strip() if cells else ''
        short_header = (i == 0 or first_cell in {'序号','编号'}) and i+1 < len(rows) and len(cells) > 1
        short_header = short_header and all(len(''.join(t.text or '' for t in c.iter(qn('w:t')))) <= 30 for c in cells)
        if diagram or short_header:
            for p in row.iter(qn('w:p')):
                p.get_or_add_pPr().get_or_add_keepNext().val = True
                if diagram:
                    # 图示单元格已有行距与内边距，无需叠加正文段前段后间距。
                    spacing = p.get_or_add_pPr().get_or_add_spacing()
                    spacing.set(qn('w:before'),'0');spacing.set(qn('w:after'),'0')


def fit_inline_images(doc, element):
    """修正无裁剪、无旋转的位图比例，保留图片字节；不改变图形或浮动对象。"""
    section = doc.sections[-1]
    max_width = section.page_width-section.left_margin-section.right_margin
    max_height = section.page_height-section.top_margin-section.bottom_margin-Pt(36)
    for inline in element.iter(qn('wp:inline')):
        blip = inline.find('.//'+qn('a:blip'))
        extent = inline.find(qn('wp:extent'))
        transform = inline.find('.//'+qn('a:xfrm'))
        crop = inline.find('.//'+qn('a:srcRect'))
        if blip is None or extent is None or transform is None: continue
        transformed = any(int(transform.get(k, '0')) for k in ('rot','flipH','flipV')) or (crop is not None and any(int(v) for v in crop.attrib.values()))
        part = doc.part.related_parts.get(blip.get(qn('r:embed')))
        if part is None or part.content_type not in {'image/png','image/jpeg','image/gif','image/bmp','image/tiff'}: continue
        image = part.image
        width = min(int(extent.get('cx')), max_width)
        aspect = int(extent.get('cx'))/int(extent.get('cy')) if transformed else image.px_width/image.px_height
        if not transformed and abs(int(extent.get('cx'))/int(extent.get('cy'))/aspect-1) > .2:
            width = max_width
        # 表内图片还必须受所在单元格宽度约束。
        cell = next((a for a in inline.iterancestors() if a.tag == qn('w:tc')), None)
        if cell is not None:
            tcw = cell.find('./'+qn('w:tcPr')+'/'+qn('w:tcW'))
            if tcw is not None and tcw.get(qn('w:type')) == 'dxa':
                width = min(width, max(1,int(tcw.get(qn('w:w')))-216)*635)
        height = width/aspect
        if height > max_height:
            width *= max_height/height; height = max_height
        inner = transform.find(qn('a:ext'))
        if transformed and inner is not None:
            scale = width/int(extent.get('cx'))
            inner.set('cx',str(round(int(inner.get('cx'))*scale)))
            inner.set('cy',str(round(int(inner.get('cy'))*scale)))
        elif inner is not None:
            inner.set('cx',str(round(width))); inner.set('cy',str(round(height)))
        extent.set('cx',str(round(width))); extent.set('cy',str(round(height)))


def compact_heading_stacks(doc):
    """连续的父子标题不叠加段前空白，表格或正文会中断连续关系。"""
    previous_heading = False
    for element in doc.element.body:
        p = Paragraph(element,doc._body) if element.tag == qn('w:p') else None
        heading = p is not None and p.style.name.startswith('Heading ')
        if heading and previous_heading and not p.paragraph_format.page_break_before:
            p.paragraph_format.space_before = Pt(0)
        previous_heading = heading


def apply(doc, selected, elements=None, *, headings=False):
    body = {**DEFAULT_BODY, **selected.get('body', {})}
    for name in ('Normal', 'Tender Body'):
        if name in doc.styles:
            style = doc.styles[name]
            fonts(style.element.get_or_add_rPr(),body['font'],body['font_size'])
            paragraph(style.element, body)
    for level in range(1,10):
        style = doc.styles[f'Heading {level}'] if f'Heading {level}' in doc.styles else doc.styles.add_style(f'Heading {level}',WD_STYLE_TYPE.PARAGRAPH,builtin=True)
        spec = {**body,'font':'黑体','font_size':{1:16,2:15,3:14}.get(level,12),**selected.get(f'heading{level}',{})}
        fonts(style.element.get_or_add_rPr(), spec['font'], spec['font_size'])
        black(style.element.get_or_add_rPr())
        paragraph(style.element,spec)
        style.font.bold=True
        style.paragraph_format.keep_with_next=True
        ol=style.element.get_or_add_pPr().find(qn('w:outlineLvl'))
        if ol is None:ol=OxmlElement('w:outlineLvl');style.element.get_or_add_pPr().append(ol)
        ol.set(qn('w:val'),str(level-1))
        link=style.element.find(qn('w:link'))
        if link is not None:
            twin=next((s for s in doc.styles if s.style_id==link.get(qn('w:val'))),None)
            if twin is not None:
                fonts(twin.element.get_or_add_rPr(),spec['font'],spec['font_size'])
                black(twin.element.get_or_add_rPr())
    if elements is None:return
    # 原件中的短图注常使用正文样式；与紧随的独立图片同页，避免图注落在上一页。
    for previous, following in zip(elements, elements[1:]):
        if previous.tag != qn('w:p') or following.tag != qn('w:p'): continue
        label = ''.join(t.text or '' for t in previous.iter(qn('w:t'))).strip()
        image_only = not ''.join(t.text or '' for t in following.iter(qn('w:t'))).strip() and next(following.iter(qn('w:drawing'),qn('w:pict')),None) is not None
        if 0 < len(label) <= 60 and image_only and next(previous.iter(qn('w:drawing'),qn('w:pict'),qn('w:fldChar')),None) is None:
            previous.get_or_add_pPr().get_or_add_keepNext().val = True
    for index, element in enumerate(elements):
        if element.tag == qn('w:tbl'):
            section = doc.sections[-1]
            fit_table(element, round((section.page_width-section.left_margin-section.right_margin)/635))
            keep_table_rows(element, elements[index+1] if index+1 < len(elements) else None)
        elif element.tag == qn('w:p'):
            p = Paragraph(element, doc._body)
            text = p.text.strip()
            runs = [r for r in p.runs if r.text.strip()]
            bold = runs and all(r.bold is True for r in runs)
            numbered = (p._p.pPr is not None and p._p.pPr.numPr is not None) or bool(re.match(r'^(?:[（(]\d+[）)]|(?:\d+|[A-Za-z])[.、．])\s*\S',text)) or bool(re.fullmatch(r'【[^】]+】',text))
            if 0 < len(text) <= 30 and (bold or numbered) and text[-1] not in '。！？；;.!?':
                p.paragraph_format.keep_with_next = True
        fit_inline_images(doc, element)
        for p in ([element] if element.tag==qn('w:p') else []) + element.findall('.//'+qn('w:p')):
            ps=p.find('./'+qn('w:pPr')+'/'+qn('w:pStyle'))
            sid=ps.get(qn('w:val')) if ps is not None else ''
            level=next((i for i in range(1,10) if doc.styles[f'Heading {i}'].style_id==sid),None)
            spec=body
            if level:
                spec={**body,'font':'黑体','font_size':{1:16,2:15,3:14}.get(level,12),**selected.get(f'heading{level}',{})}
                rpr = p.get_or_add_pPr().find(qn('w:rPr'))
                if rpr is not None: black(rpr)
                for run in p.iter(qn('w:r')):
                    black(run.get_or_add_rPr())
            paragraph(p,spec)
