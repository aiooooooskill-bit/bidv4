"""Cross-process exclusion and crash release on native Windows/Unix backends."""
import os
import subprocess
import sys
from pathlib import Path


def test_process_lock_excludes_then_recovers_after_owner_exit(tmp_path, monkeypatch):
    monkeypatch.setenv('DATA_DIR', str(tmp_path / 'data'))
    target = tmp_path / '中文 空格' / '正文.docx'
    env = {**os.environ, 'PYTHONPATH': str(Path(__file__).parents[1])}
    code = '''
import sys
from pathlib import Path
from app.file_lock import file_lock
with file_lock(Path(sys.argv[1])):
    Path(sys.argv[2]).write_text('locked', encoding='utf-8')
    print('locked', flush=True)
    if sys.argv[3] == 'hold':
        sys.stdin.read()
'''
    owner = subprocess.Popen([sys.executable, '-X', 'utf8', '-c', code, str(target), str(tmp_path/'owner'), 'hold'], env=env, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
    waiter = None
    try:
        assert owner.stdout.readline().strip() == 'locked'
        waiter = subprocess.Popen([sys.executable, '-X', 'utf8', '-c', code, str(target), str(tmp_path/'waiter'), 'once'], env=env, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
        import pytest
        with pytest.raises(subprocess.TimeoutExpired):
            waiter.communicate(timeout=0.5)
        assert not (tmp_path/'waiter').exists()
        owner.kill()
        owner.communicate(timeout=10)
        stdout, stderr = waiter.communicate(timeout=10)
        assert waiter.returncode == 0, stderr
        assert stdout.strip() == 'locked'
        assert (tmp_path/'waiter').read_text() == 'locked'
    finally:
        for process in (waiter, owner):
            if process is not None and process.poll() is None:
                process.kill()
                process.communicate(timeout=10)
