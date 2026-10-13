import json,os,subprocess,sys
from pathlib import Path
from app import db,artifact_store


def test_parallel_tool_processes_publish_one_current_artifact(tmp_path,monkeypatch):
    monkeypatch.setenv('DATA_DIR',str(tmp_path));db.init_db();task=db.create_task('并行落盘');artifact_store.ensure_task_skeleton(task['id'])
    script='''import sys,json
from app import publish
meta=publish.publish_artifact('tender.directory/tender-response-docs@1',{'response_documents':[{'name':'工程目录','directory':[{'目录名称':sys.argv[2]}]}]},task_id=sys.argv[1])
print(json.dumps(meta))
'''
    env={**os.environ,'PYTHONPATH':str(Path(__file__).resolve().parents[1])}
    processes=[subprocess.Popen([sys.executable,'-c',script,task['id'],str(i)],stdout=subprocess.PIPE,stderr=subprocess.PIPE,env=env) for i in range(6)]
    results=[]
    for process in processes:
        out,error=process.communicate(timeout=12);assert process.returncode==0,error.decode();results.append(json.loads(out))
    assert len({r['artifact_id'] for r in results})==1
    rows=db.list_artifact_index(task_id=task['id']);assert len(rows)==1 and rows[0]['content_seq']==6
    assert len(list(artifact_store.work_artifacts_dir(task['id']).iterdir()))==1


def test_parallel_creates_do_not_overwrite_existing_chapter(tmp_path,monkeypatch):
    monkeypatch.setenv('DATA_DIR',str(tmp_path));db.init_db();task=db.create_task('章节并行写入');artifact_store.ensure_task_skeleton(task['id'])
    script='''import sys
from app import runctx
from app.tools import docx_section_create
runctx.set_run('fixture','fixture',sys.argv[1])
print(docx_section_create(path='body/工程.docx',title='工程',paragraphs=sys.argv[2]))
'''
    env={**os.environ,'PYTHONPATH':str(Path(__file__).resolve().parents[1])}
    processes=[subprocess.Popen([sys.executable,'-c',script,task['id'],str(i)],stdout=subprocess.PIPE,stderr=subprocess.PIPE,env=env) for i in range(4)]
    results=[]
    for process in processes:
        out,error=process.communicate(timeout=12);assert process.returncode==0,error.decode();results.append(out.decode())
    assert sum(r.startswith('[已创建]') for r in results)==1
    assert sum('已存在' in r for r in results)==3
