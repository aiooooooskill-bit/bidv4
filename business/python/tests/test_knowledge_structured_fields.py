import asyncio
import json
from app import db, company_store as cs
from app.knowledge import extract, ingest, store
from app.services import knowledge

TEXT = '''# 虚构开户证明（仅测试）
| 字段 | 内容 |
| --- | --- |
| 账户名称 | 虚构星云演示公司 |
| 账号 | 0000123400005678 |
| 开户银行 | 虚构示例银行测试支行 |
| 法定代表人 | 测试人员甲 |
| 基本存款账户编号 | TEST000001 |
'''
EXTRA = {key: {'value': value, 'source': '第1页'} for key, value in [
    ('账户名称', '虚构星云演示公司'), ('账号', '0000123400005678'),
    ('开户银行', '虚构示例银行测试支行'), ('法定代表人', '测试人员甲'),
    ('基本存款账户编号', 'TEST000001'),
]}

def test_prompt_requires_named_attributes_in_fields_or_extra():
    prompt = extract.build_extract_prompt('虚构开户证明.png', TEXT)
    assert '不局限于时间和项目锚点' in prompt
    assert '必须同步输出到 fields 或 extra' in prompt
    assert '账号、编号保持原文，禁止转成数值' in prompt
    assert TEXT in prompt

def test_structured_bank_fields_reach_detail_without_overwriting_reviewed_values(tmp_path, monkeypatch):
    monkeypatch.setenv('DATA_DIR', str(tmp_path))
    db.init_db(); store.ensure_dirs()
    item = db.kb_insert_item(file_name='虚构开户证明.png', file_hash='test-hash', title='虚构开户证明', ext='.png')
    md, outline, _, _ = store.kb_parse_paths(item['file_name'])
    md.parent.mkdir(parents=True, exist_ok=True); md.write_text(TEXT); outline.write_text('[]')
    metadata = {'doc_type': 'other', 'fields': {}, 'extra': EXTRA}
    ingest.finish(item['id'], metadata)
    first = asyncio.run(knowledge.get_item(item['id']))
    assert first['business']['extra'] == EXTRA
    assert first['business']['extra']['账号']['value'].startswith('0000')
    # Reproduce the screenshot: an earlier human review contains no structured fields.
    db.kb_update_item(item['id'], business_metadata=json.dumps({'doc_type': 'other', 'fields': {}, 'extra': {}}), review_status='confirmed')
    ingest.finish(item['id'], metadata)
    latest = asyncio.run(knowledge.get_item(item['id']))
    assert latest['review_status'] == 'confirmed'
    assert latest['business']['extra'] == {}
    assert latest['suggested']['extra'] == EXTRA
    assert '0000123400005678' in latest['content']
