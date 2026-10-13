import asyncio
import pytest
from app import artifact_store, db, task_stage
from app.services import files, page_flow
from app.services.errors import BusinessError, IncomingFile


def test_uploaded_primary_and_saved_switch(tmp_path, monkeypatch):
    monkeypatch.setenv('DATA_DIR', str(tmp_path))
    db.init_db()
    tid = db.create_task('原招标', task_id='t_source_selection')['id']
    artifact_store.ensure_task_skeleton(tid)

    def upload(name, content=b'fixture'):
        path = tmp_path / 'upload'
        path.write_bytes(content)
        incoming = IncomingFile(path, name)
        try:
            return asyncio.run(files.upload_file(tid, incoming))
        finally:
            asyncio.run(incoming.close())

    upload('原招标.docx')
    assert page_flow.source_selection(tid)['main'] == '原招标.docx'
    assert task_stage.derive_stage(tid, set()) == 'new'
    upload('A更新.docx')
    assert page_flow.source_selection(tid)['main'] == '原招标.docx'
    before = page_flow.input_versions(tid)
    page_flow.set_sources(tid, 'A更新.docx', ['原招标.docx'])
    assert page_flow.source_selection(tid)['supplements'] == [{'file': '原招标.docx', 'role': '补充文件'}]
    assert all(page_flow.input_versions(tid)[kind] != value for kind, value in before.items())
    upload('A更新.docx', b'new revision')
    assert page_flow.source_selection(tid)['main'] == 'A更新.docx'
    with pytest.raises(BusinessError):
        page_flow.set_sources(tid, 'missing.docx', [])
    with pytest.raises(BusinessError):
        page_flow.set_sources(tid, 'A更新.docx', ['A更新.docx'])
    assert page_flow.source_selection(tid)['main'] == 'A更新.docx'
    lock = tmp_path / 'locks' / tid
    lock.parent.mkdir()
    lock.write_text('fixture')
    with pytest.raises(BusinessError):
        page_flow.set_sources(tid, '原招标.docx', [])
