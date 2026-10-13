"""Shared file receipts for short-lived DOCX tools and the existing browser renderer."""
import json,time,uuid,os
from .config import data_dir
from .parse import write_atomic
WAIT_TIMEOUT_S=75.0

def root():
    p=data_dir()/'renders';p.mkdir(parents=True,exist_ok=True);return p

def register(task_id,dest_rel,after,caption,payload):
    rid=uuid.uuid4().hex
    write_atomic(root()/(rid+'.json'),json.dumps({'task_id':task_id,'dest_rel':dest_rel,'after':after,'caption':caption,'payload':payload,'created_at':time.time()}))
    return rid

def entry(rid):
    p=root()/(rid+'.json');return json.loads(p.read_text()) if p.exists() else None

def pending():
    result=[]
    for p in root().glob('*.json'):
        e=json.loads(p.read_text());rid=p.stem
        if time.time()-e['created_at']>90:
            p.unlink(missing_ok=True);(root()/(rid+'.png')).unlink(missing_ok=True);(root()/(rid+'.failed')).unlink(missing_ok=True)
        elif not (root()/(rid+'.png')).exists() and not (root()/(rid+'.failed')).exists():result.append({'request_id':rid,'task_id':e['task_id'],**e['payload']})
    return result

def fulfill(rid,png):
    if not rid.isalnum() or entry(rid) is None:return False
    if (root()/(rid+'.png')).exists() or (root()/(rid+'.failed')).exists():return False
    if png:
        tmp=root()/(rid+'.tmp');tmp.write_bytes(png);os.replace(tmp,root()/(rid+'.png'))
    else:(root()/(rid+'.failed')).touch()
    return True

def wait(rid):
    started=time.monotonic()
    try:
        while time.monotonic()-started<WAIT_TIMEOUT_S:
            if (root()/(rid+'.failed')).exists():return None
            p=root()/(rid+'.png')
            if p.exists():return p.read_bytes()
            time.sleep(.1)
        return None
    finally:
        for suffix in ['.json','.png','.failed']:(root()/(rid+suffix)).unlink(missing_ok=True)
