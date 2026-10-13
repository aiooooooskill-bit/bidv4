"""原生解析目录按完整文件名隔离，同名不同扩展互不干扰。"""
import pytest
from app import db
from app.knowledge import materials_lib, store

@pytest.fixture
def env(tmp_path, monkeypatch):
    from tests.util import init_env
    init_env(tmp_path, monkeypatch)
    yield

def _kb_seed(file_name: str, hash_suffix: str) -> str:
    return db.kb_insert_item(file_name=file_name, file_hash=f'hash-{hash_suffix}', title=file_name, ext=file_name.rsplit('.', 1)[-1])['id']

def _mt_seed(file_name: str, hash_suffix: str) -> str:
    return db.mt_insert_file(file_name=file_name, file_hash=f'hash-{hash_suffix}')['id']

def test_kb_same_stem_isolated(env):
    a, b = ('证书.pdf', '证书.docx')
    _kb_seed(a, 'a')
    _kb_seed(b, 'b')
    for name, text in ((a, '# PDF 版'), (b, '# DOCX 版')):
        md, _, _, _ = store.kb_parse_paths(name)
        md.parent.mkdir(parents=True, exist_ok=True)
        md.write_text(text, encoding='utf-8')
        store.kb_images_dir(name).mkdir(parents=True, exist_ok=True)
        (store.kb_images_dir(name) / 'img_001.png').write_bytes(b'png')
    store.delete_item_files(a)
    md_b, _, _, _ = store.kb_parse_paths(b)
    assert md_b.read_text(encoding='utf-8') == '# DOCX 版'
    assert (store.kb_images_dir(b) / 'img_001.png').is_file()
    assert not store.kb_parse_dir(a).exists()

def test_mt_same_stem_blocks_isolated(env):
    a, b = ('历史标书.docx', '历史标书.pdf')
    fid_a, fid_b = (_mt_seed(a, 'a'), _mt_seed(b, 'b'))
    for fid, name, title in ((fid_a, a, 'docx 的块'), (fid_b, b, 'pdf 的块')):
        md, outline, _ = materials_lib.mt_parse_paths(name)
        md.parent.mkdir(parents=True, exist_ok=True)
        md.write_text(f'# {name}', encoding='utf-8')
        outline.write_text('[]', encoding='utf-8')
        materials_lib.write_blocks(fid, [{'id': f'blk_{name}', 'title': title, 'ranges': [[1, 2]]}])
    assert materials_lib.read_blocks(fid_a) != materials_lib.read_blocks(fid_b)
    assert materials_lib.read_blocks(fid_a)[0]['title'] == 'docx 的块'
    assert materials_lib.read_blocks(fid_b)[0]['title'] == 'pdf 的块'
