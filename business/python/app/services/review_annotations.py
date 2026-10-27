"""Separate, complete Word annotations; body source line numbers never move."""
import json
from docx.oxml.ns import qn
from ..parse import write_atomic
from ..parse.docx_text import load_text_document, paragraph_text
from . import page_flow


def prepare(item):
    if item['file'].suffix.lower() != '.docx':
        return
    doc, _ = load_text_document(item['file'])
    anchors = {}
    # Include table/nested-table paragraphs and reference-only or orphan comments.
    paragraphs = list(doc.element.body.iter(qn('w:p')))
    for index, paragraph in enumerate(paragraphs):
        for tag in ('commentRangeStart', 'commentRangeEnd', 'commentReference'):
            for mark in paragraph.iter(qn('w:' + tag)):
                cid = mark.get(qn('w:id'))
                anchor = {'body_paragraph_index': index, 'text': paragraph_text(paragraph)}
                if anchor not in anchors.setdefault(cid, []):
                    anchors[cid].append(anchor)
    lines = ['# Word 批注全文', '证据类型：annotation。批注不是已印入正文的响应、已确认事实或已完成的承诺；只能证明待办、疑问及资料缺口。']
    entries = []
    for comment in doc.comments:
        cid = str(comment.comment_id)
        start = len(lines) + 1
        locations = anchors.get(cid, [])
        if locations:
            indices = [a['body_paragraph_index'] for a in locations]
            locations = [{'body_paragraph_index': i, 'text': paragraph_text(paragraphs[i])} for i in range(min(indices), max(indices) + 1)]
        text = '\n'.join(paragraph_text(p) for p in comment._element.iter(qn('w:p')))
        lines += ['', f'## 批注 {cid}', '锚点：' + json.dumps(locations, ensure_ascii=False) if locations else '锚点：未定位（保留原批注，不推定对应正文）',
                  '批注原文：', *text.replace('\r\n', '\n').replace('\r', '\n').split('\n')]
        entries.append({'comment_id': cid, 'start': start, 'end': len(lines), 'body_paragraph_indices': [a['body_paragraph_index'] for a in locations]})
    path = item['parse_dir'] / (item['name'] + '.annotations.md')
    text = '\n'.join(lines)
    write_atomic(path, text)
    manifest = {'source_sha256': item['sha256'], 'sha256': page_flow.file_hash(path), 'lines': len(text.splitlines()), 'comments': entries}
    write_atomic(path.with_suffix('.json'), json.dumps(manifest, ensure_ascii=False))


def descriptor(item):
    if item['file'].suffix.lower() != '.docx':
        return None
    path = item['parse_dir'] / (item['name'] + '.annotations.md')
    stamp = path.with_suffix('.json')
    if not path.is_file() or not stamp.is_file():
        raise ValueError('Word 批注证据尚未准备：' + item['name'])
    info = json.loads(stamp.read_text())
    if info['source_sha256'] != item['sha256'] or info['sha256'] != page_flow.file_hash(path):
        raise ValueError('Word 批注证据版本已变化，请重新准备：' + item['name'])
    if not info['comments']:
        return None
    return {'id': item['id'] + '-annotations', 'parent_document_id': item['id'],
            'kind': item['kind'], 'name': item['name'] + ' · Word批注', 'evidence_type': 'annotation',
            'path': str(path), 'sha256': info['sha256'], 'source_sha256': item['sha256'],
            'lines': info['lines'], 'comments': info['comments']}
