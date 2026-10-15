"""Add navigation bookmarks to a preview copy, using the parser's source coordinates."""
import os
import shutil
import tempfile
from zipfile import ZipFile

from docx.oxml import OxmlElement
from docx.oxml.ns import qn

from ..parse.docx_text import load_text_document
from . import materials_lib as mlib


def build_preview(file: dict):
    source = mlib.mt_files_dir() / file['file_name']
    mapping = mlib.read_element_map(file['file_name'])
    if not mapping:
        raise ValueError('章节位置数据缺失，请重新解析文件后再试。')
    document, _ = load_text_document(source)
    elements = list(document.element.body)
    bookmark_id = max((int(n.get(qn('w:id'), '0')) for n in document.element.iter(qn('w:bookmarkStart'))), default=0)

    def mark(nodes):
        nonlocal bookmark_id
        for node in nodes:
            line = node['start_line']
            index = next((i for i, start, end in mapping if start <= line <= end), None)
            if index is None or index >= len(elements) or elements[index].tag != qn('w:p'):
                raise ValueError('章节与原文位置不一致，请重新解析文件后再试。')
            bookmark_id += 1
            start, end = OxmlElement('w:bookmarkStart'), OxmlElement('w:bookmarkEnd')
            start.set(qn('w:id'), str(bookmark_id))
            start.set(qn('w:name'), f"bid_{file['id']}_{line}")
            end.set(qn('w:id'), str(bookmark_id))
            paragraph = elements[index]
            paragraph.insert(1 if paragraph.find(qn('w:pPr')) is not None else 0, start)
            paragraph.append(end)
            mark(node.get('children') or [])

    mark(mlib.read_outline(file['id']))
    target = mlib.mt_parse_dir(file['file_name']) / 'source-preview.docx'
    fd, temporary = tempfile.mkstemp(prefix='.source-preview-', dir=target.parent)
    os.close(fd)
    try:
        # Copy images and embedded files in bounded chunks, including very large sources.
        with ZipFile(source) as archive, ZipFile(temporary, 'w') as output:
            for entry in archive.infolist():
                if entry.filename == str(document.part.partname).lstrip('/'):
                    output.writestr(entry, document.part.blob)
                else:
                    with archive.open(entry) as src, output.open(entry, 'w') as dst:
                        shutil.copyfileobj(src, dst, length=1024 * 1024)
        os.replace(temporary, target)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)
    return target
