"""Read-time capabilities: storing or locating a file does not prove a fact."""
import json
from . import store
from .types import type_name

def metadata(item):
    return json.loads(item.get('business_metadata') or item.get('suggested_metadata') or '{}')

def identity(item):
    parts = [item['title'], item['file_name']]
    if item.get('review_status') == 'confirmed':
        parts.append(type_name(item.get('doc_type')))
    return ' '.join(parts)

def availability(item):
    md = store.kb_parse_paths(item['file_name'])[0]
    text = item.get('corrected_text')
    if text is None:
        text = md.read_text(encoding='utf-8') if md.is_file() else ''
    meta = metadata(item)
    fields = any(str(v.get('value', '') if isinstance(v, dict) else v).strip()
                 for group in ('fields', 'extra') for v in (meta.get(group) or {}).values())
    usable = bool(text.strip() or fields or (meta.get('statement') or '').strip())
    manual = item.get('review_status') == 'confirmed' and usable
    label = '有人工核对内容' if manual else '有识别内容·待人工核对' if usable else '仅原件可定位·无可用事实内容'
    return {'usable': usable, 'has_text': bool(text.strip()), 'has_fields': fields,
            'source': 'human' if manual else 'machine' if usable else 'raw', 'label': label}
