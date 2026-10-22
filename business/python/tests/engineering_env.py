import pytest
from app import artifact_store,runctx
from tests.util import init_env

@pytest.fixture
def env(tmp_path,monkeypatch):
 task,conv=init_env(tmp_path,monkeypatch);tid=task['id'];runctx.set_run(conv['id'],'engineering-regression',tid)
 root=artifact_store.work_dir(tid);(root/'body').mkdir(parents=True,exist_ok=True)
 try:yield tid,root
 finally:runctx.clear_run()
