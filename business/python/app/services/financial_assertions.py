"""Locate financial assertions for the same auditor; no automatic truth verdict."""
import hashlib
import re
from . import review

# Narrow review triggers, not a substitute for reading the rest of the bid.
CLAIM = re.compile(
    r'(?:成本|投入|费用).{0,24}(?:均匀|均衡|回收|收回|已.{0,6}(?:测算|核算|覆盖|考虑))'
    r'|(?:回收|收回).{0,18}(?:成本|投入|费用)'
    r'|(?:报价|价格).{0,18}(?:已.{0,6}(?:考虑|测算|比价|比较)|充分考虑)'
    r'|(?:已.{0,6}(?:横向比价|价格比较)|(?:备有|备查|可现场提供).{0,22}(?:成本|测算|单价|工时))'
    r'|(?:成本|测算|单价|工时).{0,22}(?:备查|可现场提供)'
    r'|(?:作|进行|完成|开展).{0,4}(?:横向比对|横向比价|价格比较)'
    r'|上表.{0,6}(?:合同价格|合同金额|价格)')
NON_ASSERTION = re.compile(r'不得|不能|尚未|未完成|待核|待补|拟采用|拟按|拟进行|拟开展|不代表|不据此')


def candidates(tid):
    found = []
    for doc in review.documents(tid):
        if doc['kind'] != 'bid':
            continue
        from pathlib import Path
        for line, text in enumerate(Path(doc['path']).read_text().splitlines(), 1):
            # Keep the complete original line and its actual address; no summary.
            if CLAIM.search(text):
                e = {'document_id': doc['id'], 'start': line, 'end': line}
                key = hashlib.sha256(f'{doc["id"]}:{line}:{text}'.encode()).hexdigest()[:16]
                found.append({'id': key, 'evidence': e, 'text': text.rstrip('\r\n')})
    return found


def owner(groups):
    rows = [r for group in groups for r in group]
    for pattern in (r'成本|低价|报价合理', r'付款|支付|报价'):
        row = next((r for r in rows if re.search(pattern, r['text']) and r['category'] != '结构事实'), None)
        if row:
            return row['id']
    return rows[0]['id']


def not_asserted(text):
    sentences = [s for s in re.split(r'[。！？；\n]', text) if CLAIM.search(s)]
    return bool(sentences) and all(NON_ASSERTION.search(s) for s in sentences)


def assigned(tid, groups, requirements):
    target = owner(groups)
    return {target: candidates(tid)} if any(r['id'] == target for r in requirements) else {}
