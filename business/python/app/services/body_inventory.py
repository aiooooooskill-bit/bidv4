"""目录细化时提供既有正文结构；内容本身仍以原DOCX为准。"""
import hashlib
from docx import Document
from docx.oxml.ns import qn
from .. import artifact_store
from ..tools import body_contract


def snapshot(tid, content):
    from ..tools.docx_ops import _heading_style_ids
    root = artifact_store.work_dir(tid)
    result = []
    for vol, title, _ in body_contract.body_nodes_for_task(tid, content):
        path = 'body/' + (body_contract.volume_key(vol) + '/' if body_contract.multi_volume(content) else '') + body_contract.sanitize_name(title) + '.docx'
        file = root / path
        if not file.is_file():
            continue
        doc = Document(file)
        styles = _heading_style_ids(doc)
        headings = []
        blocks = [e for e in doc.element.body if e.tag != qn('w:sectPr')]
        for number, e in enumerate(blocks, 1):
            style = e.find('./' + qn('w:pPr') + '/' + qn('w:pStyle'))
            outline = e.find('./' + qn('w:pPr') + '/' + qn('w:outlineLvl'))
            if (style is not None and style.get(qn('w:val')) in styles) or (outline is not None and outline.get(qn('w:val')) != '9'):
                headings.append({'block': number, 'title': ''.join(t.text or '' for t in e.iter(qn('w:t')))})
        result.append({'volume': vol, 'title': title, 'path': path,
                       'sha256': hashlib.sha256(file.read_bytes()).hexdigest(), 'block_count': len(blocks),
                       'tables': len(doc.tables), 'images': len(list(doc.element.body.iter(qn('a:blip')))), 'headings': headings})
    return result
