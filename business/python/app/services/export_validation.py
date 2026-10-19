"""校验Word原生域、引用和分节，不宣称已完成实际分页。"""
import hashlib
import re
from zipfile import ZipFile
from docx import Document
from docx.oxml.ns import qn


def document_digest(path):
    digest = hashlib.sha256()
    with ZipFile(path) as package:
        for name in sorted(package.namelist()):
            digest.update(name.encode())
            digest.update(hashlib.sha256(package.read(name)).digest())
    return digest.hexdigest()


def fields(element, *, require_closed=True):
    stack = []
    result = []
    for node in element.iter():
        if node.tag == qn('w:fldChar'):
            kind = node.get(qn('w:fldCharType'))
            if kind == 'begin':
                stack.append({'code': '', 'value': '', 'result': False})
            elif kind == 'separate' and stack:
                stack[-1]['result'] = True
            elif kind == 'end' and stack:
                result.append(stack.pop())
        elif node.tag == qn('w:instrText') and stack:
            stack[-1]['code'] += node.text or ''
        elif node.tag == qn('w:t'):
            for item in stack:
                if item['result']:
                    item['value'] += node.text or ''
    if stack and require_closed:
        raise ValueError('导出文档存在未闭合的目录或页码域')
    return result


def verify(path, rows, has_cover, selected):
    document = Document(path)
    generated = {row['name']:row for row in rows if row['name']}
    unresolved=[row['title'] for row in rows if not row['name']]
    starts=list(document.element.body.iter(qn('w:bookmarkStart')))
    bookmarks={b.get(qn('w:name')) for b in starts}
    if len(bookmarks)!=len(starts):
        raise ValueError('Word中存在重名书签，无法安全更新页码')
    body_fields=fields(document.element.body)
    if sum(bool(re.match(r'\s*TOC\b',f['code'])) for f in body_fields)!=1:
        raise ValueError('导出文档没有唯一的有效目录域')
    actual={}
    for p in document.paragraphs:
        for ref in fields(p._p,require_closed=False):
            if not re.match(r'\s*PAGEREF\s+_TenderHeading\d+\b',ref['code']):continue
            name=ref['code'].split()[1]
            if name not in generated or name in actual:
                raise ValueError('导出目录存在未知或重复的章节引用：'+name)
            title=p.text.rsplit('\t',1)[0]
            if ''.join(title.split())!=''.join(generated[name]['title'].split()):
                raise ValueError('导出目录标题编号与正文不一致：'+title)
            actual[name]=True
    if set(actual)!=set(generated):raise ValueError('导出目录缺少章节引用')
    material=0
    for ref in body_fields:
        if re.match(r'\s*PAGEREF\b',ref['code']):
            target=ref['code'].split()[1]
            if target not in bookmarks:raise ValueError('页码引用缺少实际目标书签：'+target)
            if target.startswith('TenderRef'):material+=1
    update=document.settings.element.find(qn('w:updateFields'))
    if update is None or update.get(qn('w:val'))!='true':
        raise ValueError('Word缺少打开时更新域设置')
    first=1 if has_cover else 0
    if has_cover and any(fields(s.footer._element) for s in document.sections[:first]):
        raise ValueError('封面仍有页码域')
    for i,section in enumerate(document.sections[first:],first):
        numbers=section._sectPr.find(qn('w:pgNumType'))
        if numbers is None or (i==first and numbers.get(qn('w:start'))!='1') or (i>first and numbers.get(qn('w:start')) is not None):
            raise ValueError('目录、正文和附件没有连续页码设置')
        footer_fields=fields(section.footer._element)
        if sum(f['code'].strip()=='PAGE' for f in footer_fields)!=1:
            raise ValueError('导出页脚缺少唯一当前页码域')
        totals=[f for f in footer_fields if re.match(r'\s*PAGEREF\s+_TenderCountedEnd\d+\b',f['code'])]
        if len(totals)!=1 or totals[0]['code'].split()[1] not in bookmarks:
            raise ValueError('总页数没有引用实际正文末尾书签')
    return {'verified':True,'document_digest':document_digest(path),'toc_entries':len(actual),
            'material_page_refs':material,'unresolved_toc_entries':unresolved,
            'pagination_calculated':False,'field_update':'on_open'}
