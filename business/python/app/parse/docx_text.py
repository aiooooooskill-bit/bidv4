"""Load Word text/style parts without decompressing image or embedded-file payloads.

python-docx still interprets paragraphs, styles and tables. The source package is
read-only; drawing XML and image counts remain available as evidence limitations.
"""
from pathlib import PurePosixPath
from posixpath import normpath
from xml.etree import ElementTree
from zipfile import ZipFile

from docx.opc.constants import CONTENT_TYPE as CT, RELATIONSHIP_TYPE as RT
from docx.opc.packuri import PackURI
from docx.package import Package
from docx.parts.document import DocumentPart
from docx.parts.settings import SettingsPart
from docx.parts.styles import StylesPart
from docx.parts.comments import CommentsPart
from docx.oxml.ns import qn

TEXT_VIEW = 'current-revisions'


def paragraph_text(element):
    """Read the current Word text, including insertions and excluding deletions.

    Do not flatten the XML: source element indexes must remain stable for injection.
    """
    parts = []
    def collect(node):
        if node.tag in (qn('w:del'), qn('w:moveFrom')):
            return
        if node.tag == qn('w:t'):
            parts.append(node.text or '')
        elif node.tag == qn('w:tab'):
            parts.append('\t')
        elif node.tag in (qn('w:br'), qn('w:cr')):
            parts.append('\n')
        for child in node:
            collect(child)
    collect(element)
    return ''.join(parts)


def _relationships(archive, member):
    path = PurePosixPath(member)
    rels = str(path.parent / '_rels' / (path.name + '.rels')) if member else '_rels/.rels'
    try:
        xml = archive.read(rels)
    except KeyError:
        return []
    base = str(path.parent) if member else ''
    result = []
    for relation in ElementTree.fromstring(xml):
        if relation.get('TargetMode') == 'External':
            continue
        target = relation.attrib['Target']
        target = normpath(target.lstrip('/') if target.startswith('/') else base + '/' + target)
        # Package root is virtual; root-relative names do not denote host files.
        target = target.lstrip('/')
        result.append((relation.attrib['Type'], target))
    return result


def load_text_document(path):
    with ZipFile(path) as archive:
        main = next(target for kind, target in _relationships(archive, '') if kind == RT.OFFICE_DOCUMENT)
        part = DocumentPart.load(PackURI('/' + main), CT.WML_DOCUMENT_MAIN, archive.read(main), Package())
        main_relations = _relationships(archive, main)
        for kind, target in main_relations:
            if kind == RT.STYLES:
                styles = StylesPart.load(PackURI('/' + target), CT.WML_STYLES, archive.read(target), part.package)
                part.relate_to(styles, RT.STYLES)
            elif kind == RT.SETTINGS:
                settings = SettingsPart.load(PackURI('/' + target), CT.WML_SETTINGS, archive.read(target), part.package)
                part.relate_to(settings, RT.SETTINGS)
            elif kind == RT.COMMENTS:
                comments = CommentsPart.load(PackURI('/' + target), CT.WML_COMMENTS, archive.read(target), part.package)
                part.relate_to(comments, RT.COMMENTS)
        images, visited, pending = set(), set(), [main]
        while pending:
            member = pending.pop()
            if member in visited:
                continue
            visited.add(member)
            for kind, target in _relationships(archive, member):
                archive.getinfo(target)
                if kind == RT.IMAGE:
                    images.add(target)
                pending.append(target)
        return part.document, len(images)
