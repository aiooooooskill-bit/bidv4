"""特殊册名从分册回执到正文、状态、合册全链路无覆盖。"""
from docx import Document
from app import publish
from app.services import body_inventory, build_state, outline_contract
from app.tools import body_contract
from app.tools.docx_ops import docx_section_create, docx_assemble_volume
from app.tools.check_pipeline import check_pipeline_state
from app.tools.validate_body import _validate_guide
import pytest
from tests.test_document_pagination import setup, node


def test_fragment_body_and_volume_share_unique_keys_without_source_changes(tmp_path, monkeypatch):
    tid, root = setup(tmp_path, monkeypatch)
    names = ['商务册', '技术/资格册', '技术:资格册', '超长响应册' * 14]
    title = '实施方案'
    content = {'numbering': 'decimal', 'response_documents': [
        {'name': name, 'directory': [node('封面'), {**node('目录'), '交付形态': '模板或附件填充'}, node(title)]} for name in names
    ]}
    publish.publish_artifact('tender.directory/tender-response-docs@1', content, task_id=tid)
    sections = build_state.sections(tid)
    paths = [s['path'] for s in sections]
    assert len(paths) == len(set(paths)) == 8
    keys = [body_contract.volume_key(name) for name in names]
    assert len(set(keys)) == 4
    assert keys[0] == names[0]
    assert all(outline_contract.fragment_path(tid, name).stem == key for name, key in zip(names, keys))

    for index, key in enumerate(keys):
        for heading in ['封面', title]:
            result = docx_section_create(f'body/{key}/{heading}', heading,
                                         paragraphs=f'第{index}册独有内容，采购原册名：{names[index]}。')
            assert result.startswith('[已创建]'), result
    originals = {p: (root / p).read_bytes() for p in paths}
    inventory = body_inventory.snapshot(tid, content)
    assert {item['path'] for item in inventory} == set(paths)
    bases = [build_state.volume_basis(tid, doc) for doc in content['response_documents']]
    assert len(set(bases)) == 4
    result = docx_assemble_volume()
    assert '已发布为整本' in result, result
    states = build_state.volume_states(tid, build_state.read(tid))
    assert len(states) == 4 and all(s['status'] == 'ready' for s in states), states
    for index, key in enumerate(keys):
        output = root / f'body/整本-{key}.docx'
        text = '\n'.join(p.text for p in Document(output).paragraphs)
        assert f'第{index}册独有内容' in text
        assert all(f'第{other}册独有内容' not in text for other in range(4) if other != index)
    assert all((root / path).read_bytes() == blob for path, blob in originals.items())
    state_text = check_pipeline_state()
    assert '已写 8 节' in state_text and '叶子对账一致' in state_text, state_text
    assert '无对应目录节点' not in state_text and '文件名冲突' not in state_text

    # 一册正文改变只使本册过期；合册再执行也不能改变其他册或任何原章。
    edited = root / f'body/{keys[1]}/{title}.docx'
    doc = Document(edited); doc.add_paragraph('仅修改第二册。'); doc.save(edited)
    states = build_state.volume_states(tid, build_state.read(tid))
    assert [s['status'] for s in states] == ['ready', 'stale', 'ready', 'ready']
    assert all((root / path).read_bytes() == blob for path, blob in originals.items() if path != str(edited.relative_to(root)))


@pytest.mark.parametrize('mode', ['正文编写', '混合', '待核验'])
def test_plain_parent_groups_children_until_it_has_real_existing_body(tmp_path, monkeypatch, mode):
    tid, root = setup(tmp_path, monkeypatch)
    content = {'response_documents': [{'name': '技术册', 'directory': [
        {**node('实施方案', [node('人员安排')]), '交付形态': mode}
    ]}]}
    publish.publish_artifact('tender.directory/tender-response-docs@1', content, task_id=tid)
    assert [s['title'] for s in build_state.sections(tid)] == ['人员安排']
    guide = '| 节 | 模式 | 依据 | 素材 | 缺口/备注 |\n|---|---|---|---|---|\n| 人员安排 | 推理撰写 | — | — | 无 |\n'
    assert _validate_guide(guide, tid)[0] == []
    assert docx_section_create('body/人员安排', '人员安排', paragraphs='人员职责按实际安排落实。').startswith('[已创建]')
    docx_assemble_volume()
    assert not (root / 'body/实施方案.docx').exists()

    # 目录细化前留下的真实正文仍进入合册，不因父级身份删除或漏掉。
    parent = root / 'body/实施方案.docx'
    doc = Document(); doc.add_heading('实施方案', 1); doc.add_paragraph('原有父章节内容必须完整保留。'); doc.save(parent)
    before = parent.read_bytes()
    assert [s['title'] for s in build_state.sections(tid)] == ['实施方案', '人员安排']
    docx_assemble_volume()
    merged = Document(root / 'body/整本-技术册.docx')
    assert any(p.text == '原有父章节内容必须完整保留。' for p in merged.paragraphs)
    assert parent.read_bytes() == before
