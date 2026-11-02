"""Create/archive requests must serialize for the same immutable project ID."""
import json
import os
from pathlib import Path
import subprocess
import sys
import uuid

import pytest

RUNNER = Path(__file__).parents[1] / 'runner.py'
WORKER = '''
import io,json,runpy,sys
request=json.loads(sys.argv[2])
import os
os.environ['DATA_DIR']=request['data_root']
from app import db
if sys.argv[3]:
    name=sys.argv[3]
    original=getattr(db,name)
    def hold(*args,**kwargs):
        setattr(db,name,original)
        print('HOLD',flush=True)
        sys.__stdin__.read(1)
        return original(*args,**kwargs)
    setattr(db,name,hold)
else:
    print('READY',flush=True)
sys.stdin=io.StringIO(json.dumps(request))
runpy.run_path(sys.argv[1],run_name='__main__')
'''


def request(data, operation, args):
    return {'data_root': str(data), 'operation': operation, 'args': args}


def run(payload):
    result = subprocess.run([sys.executable, str(RUNNER)], input=json.dumps(payload), capture_output=True, text=True, timeout=15)
    return result.returncode, json.loads(result.stdout)


def start(payload, hold=''):
    return subprocess.Popen([sys.executable, '-c', WORKER, str(RUNNER), json.dumps(payload), hold],
                            env={**os.environ, 'PYTHONPATH': str(RUNNER.parent)},
                            stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)


@pytest.mark.parametrize('first', ['create_task', 'archive_task'])
def test_create_and_archive_are_serialized_in_both_orders(tmp_path, first):
    request_id = str(uuid.uuid4())
    tid = 't_' + uuid.UUID(request_id).hex
    create = request(tmp_path, 'create_task', {'request_id': request_id, 'title': '并发归档验证'})
    archive = request(tmp_path, 'archive_task', {'task_id': tid})
    assert run(create)[0] == 0
    marker = tmp_path / 'workspace' / tid / 'work/analysis/structure.md'
    marker.write_text('# 旧项目成果', encoding='utf-8')
    owner = waiter = None
    try:
        owner = start(create if first == 'create_task' else archive,
                      'get_task' if first == 'create_task' else 'delete_task')
        assert owner.stdout.readline().strip() == 'HOLD'
        waiter = start(archive if first == 'create_task' else create)
        assert waiter.stdout.readline().strip() == 'READY'
        with pytest.raises(subprocess.TimeoutExpired):
            waiter.communicate(timeout=0.5)
        stdout, stderr = owner.communicate(input='\n', timeout=15)
        assert owner.returncode == 0, stdout + stderr
        stdout, stderr = waiter.communicate(timeout=15)
        result = json.loads(stdout)
        if first == 'archive_task':
            assert waiter.returncode == 1, stderr
            assert result['status'] == 409
            assert '已归档' in result['error']
        else:
            assert waiter.returncode == 0, stdout + stderr
        assert not (tmp_path / 'workspace' / tid).exists()
        archived = tmp_path / 'workspace/archive' / tid / 'work/analysis/structure.md'
        assert archived.read_text(encoding='utf-8') == '# 旧项目成果'
        assert run(create)[1]['status'] == 409
        assert run(request(tmp_path, 'tasks', {}))[1]['result']['tasks'] == []
    finally:
        for process in (owner, waiter):
            if process is not None and process.poll() is None:
                process.kill()
                process.communicate(timeout=10)


def test_concurrent_retries_reuse_one_active_project(tmp_path):
    request_id = str(uuid.uuid4())
    payload = request(tmp_path, 'create_task', {'request_id': request_id, 'title': '重复上传请求'})
    assert run(payload)[0] == 0
    processes = [start(payload) for _ in range(4)]
    try:
        ids = []
        for process in processes:
            stdout, stderr = process.communicate(timeout=15)
            assert process.returncode == 0, stdout + stderr
            ids.append(json.loads(stdout.splitlines()[-1])['result']['task']['id'])
        assert len(set(ids)) == 1
        assert len(run(request(tmp_path, 'tasks', {}))[1]['result']['tasks']) == 1
    finally:
        for process in processes:
            if process.poll() is None:
                process.kill()
                process.communicate(timeout=10)
