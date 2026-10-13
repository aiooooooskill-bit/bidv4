import asyncio
import json
from pathlib import Path

import pytest

from app import artifact_store
from app.services import workbench
from app.services.errors import BusinessError
from app.work_paths import normalize_work_path, resolve_work_path
from tests.util import init_env

CASES = json.loads((Path(__file__).resolve().parents[3] / 'tests/fixtures/work-paths.json').read_text())


@pytest.mark.parametrize('path,expected', CASES['accepted'])
def test_normalize_cross_platform_paths(path, expected):
    assert normalize_work_path(path) == expected


@pytest.mark.parametrize('path', CASES['rejected'])
def test_reject_absolute_and_escaping_paths(path):
    with pytest.raises(ValueError, match='路径越界'):
        normalize_work_path(path)


@pytest.mark.parametrize('path', ['./parse/来源.md', r'parse\来源.md', r'body\..\parse\来源.md'])
def test_parse_aliases_are_readonly_for_reads_and_writes(tmp_path, monkeypatch, path):
    task, _ = init_env(tmp_path, monkeypatch)
    tid = task['id']
    artifact_store.ensure_task_skeleton(tid)
    target = artifact_store.work_dir(tid) / 'parse/来源.md'
    target.write_text('原文', encoding='utf-8')
    assert resolve_work_path(tid, path) == target.resolve()
    assert not asyncio.run(workbench.read_meta(tid, path))['editable']
    assert not asyncio.run(workbench.read_content(tid, path))['editable']
    with pytest.raises(BusinessError, match='解析产物只读'):
        asyncio.run(workbench.write_content(workbench.WorkbenchWrite(task_id=tid, path=path, content='篡改', base_hash=workbench._hash('原文'))))
    assert target.read_text() == '原文'


def test_symlink_aliases_cannot_escape_or_edit_parse(tmp_path, monkeypatch):
    task, _ = init_env(tmp_path, monkeypatch)
    tid = task['id']
    artifact_store.ensure_task_skeleton(tid)
    root = artifact_store.work_dir(tid)
    target = root / 'parse/来源.md'
    target.write_text('原文')
    outside = tmp_path / 'outside.md'
    outside.write_text('外部文件')
    try:
        (root / 'body/引用.md').symlink_to(target)
        (root / 'body/外部.md').symlink_to(outside)
    except OSError:
        pytest.skip('当前文件系统未开放符号链接')
    assert not asyncio.run(workbench.read_content(tid, 'body/引用.md'))['editable']
    with pytest.raises(BusinessError, match='解析产物只读'):
        asyncio.run(workbench.write_content(workbench.WorkbenchWrite(task_id=tid, path='body/引用.md', content='篡改', base_hash=workbench._hash('原文'))))
    with pytest.raises(ValueError, match='路径越界'):
        resolve_work_path(tid, 'body/外部.md')


def test_parse_case_alias_stays_readonly_on_case_insensitive_filesystem(tmp_path, monkeypatch):
    task, _ = init_env(tmp_path, monkeypatch)
    tid = task['id']
    artifact_store.ensure_task_skeleton(tid)
    root = artifact_store.work_dir(tid)
    target = root / 'parse/来源.md'
    target.write_text('原文')
    if not (root / 'PARSE/来源.md').is_file():
        pytest.skip('当前文件系统区分大小写，没有此别名')
    assert not asyncio.run(workbench.read_meta(tid, 'PARSE/来源.md'))['editable']
    with pytest.raises(BusinessError, match='解析产物只读'):
        asyncio.run(workbench.write_content(workbench.WorkbenchWrite(task_id=tid, path='PARSE/来源.md', content='篡改', base_hash=workbench._hash('原文'))))
