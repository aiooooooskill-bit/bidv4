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


def test_bid_upload_has_no_source_size_cap_and_rejected_source_is_atomic(tmp_path,monkeypatch):
    monkeypatch.setenv('DATA_DIR',str(tmp_path));db.init_db()
    tid=db.create_task('容量契约')['id'];artifact_store.ensure_task_skeleton(tid)
    monkeypatch.setattr(files,'MAX_UPLOAD_BYTES',1024)
    path=tmp_path/'incoming';path.write_bytes(b'x'*8192)
    def upload(purpose,name):
        incoming=IncomingFile(path,name)
        try:return asyncio.run(files.upload_file(tid,incoming,purpose=purpose))
        finally:asyncio.run(incoming.close())
    result=upload('bid','投标.docx');assert result['size']==8192
    with pytest.raises(BusinessError,match='100MB'):upload('source','招标.docx')
    assert not (artifact_store.sources_dir(tid)/'招标.docx').exists()
    assert not list(artifact_store.sources_dir(tid).glob('.*.part'))
    assert (artifact_store.sources_dir(tid)/'投标.docx').stat().st_size==8192
