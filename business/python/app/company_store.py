"""Company identities and reviewed asset values; no inferred ownership."""
from contextlib import contextmanager
import json
import uuid
from . import db
from .services.errors import BusinessError

@contextmanager
def transaction():
    conn = db._conn()
    try:
        conn.execute('BEGIN IMMEDIATE')
        yield conn
        conn.commit()
    except BaseException:
        conn.rollback()
        raise
    finally:
        conn.close()

def read(sql, args=()):
    conn = db._conn()
    try:
        return [dict(r) for r in conn.execute(sql, args)]
    finally:
        conn.close()

def companies():
    return [{**r,'profile':json.loads(r['profile'])} for r in read('SELECT * FROM companies ORDER BY created_at,id')]

def company(cid):
    return next((r for r in companies() if r['id']==cid), None)

def require_company(cid):
    result = company(cid)
    if not result: raise BusinessError(422, '请选择有效的投标主体')
    return result

def asset_state(kid):
    rows = read('SELECT * FROM company_assets WHERE item_id=?', (kid,))
    return rows[0] if rows else {'company_id':None,'revision':0,'corrected_text':None}

def check_revision(current, expected):
    if expected != current:
        raise BusinessError(409,'资料已被其他操作更新；当前输入已保留，请重新读取后核对再保存')

def save_entity(table, key, values, revision):
    with transaction() as c:
        if table=='companies':
            profile=json.loads(values['profile'])
            for field,kid in profile.items():
                if not field.startswith('source-id:'):continue
                source=c.execute('SELECT revision,company_id FROM company_assets WHERE item_id=?',(kid,)).fetchone()
                expected=profile.get('source-revision:'+field.removeprefix('source-id:'))
                if not source or source['company_id']!=key or str(source['revision'])!=expected:
                    raise BusinessError(409,'采用的来源资料已更新或归属变化；请重新读取资料候选值核对，或手工维护该字段')
        existing = c.execute(f'SELECT revision FROM {table} WHERE id=?',(key,)).fetchone()
        check_revision(existing['revision'] if existing else 0, revision)
        if existing:
            columns=','.join(f'{k}=?' for k in values)
            c.execute(f'UPDATE {table} SET {columns},revision=revision+1 WHERE id=?', [*values.values(),key])
        else:
            cols=','.join(values)
            c.execute(f'INSERT INTO {table}(id,{cols}) VALUES({",".join("?" for _ in range(len(values)+1))})',[key,*values.values()])
    return key

def save_asset(kid, revision, company_id, title, metadata, text):
    require_company(company_id)
    with transaction() as c:
        item=c.execute('SELECT * FROM kb_items WHERE id=?',(kid,)).fetchone()
        if not item:raise BusinessError(404,'资料不存在')
        if item['parse_status'] in ('pending','parsing','extracting') or item['extract_status']=='running':
            raise BusinessError(409,'资料正在识别，请处理结束后再核对保存')
        current=c.execute('SELECT revision FROM company_assets WHERE item_id=?',(kid,)).fetchone()
        check_revision(current['revision'] if current else 0, revision)
        c.execute('INSERT INTO company_assets(item_id,company_id,revision,corrected_text) VALUES(?,?,?,?) ON CONFLICT(item_id) DO UPDATE SET company_id=excluded.company_id,revision=excluded.revision,corrected_text=excluded.corrected_text',(kid,company_id,revision+1,text))
        c.execute("UPDATE kb_items SET title=?,doc_type=?,business_metadata=?,review_status='confirmed',updated_at=? WHERE id=?",(title,metadata['doc_type'],json.dumps(metadata,ensure_ascii=False),db._now(),kid))
    from .knowledge.ingest import reindex_item
    reindex_item(kid)

def attach_asset(kid,cid):
    require_company(cid)
    with transaction() as c:
        c.execute('INSERT INTO company_assets(item_id,company_id,revision) VALUES(?,?,1) ON CONFLICT(item_id) DO UPDATE SET company_id=excluded.company_id,revision=revision+1',(kid,cid))

def new_id(prefix):return prefix+'_'+uuid.uuid4().hex[:12]

def require_asset_path(tid,path):
    """Validate resolved library files for retrieval and certificate insertion."""
    from .config import knowledge_dir
    from .services.bidder import require_confirmed
    from pathlib import Path
    target=Path(path).resolve();root=knowledge_dir().resolve()
    if target in root.parents:
        raise BusinessError(409,'请在项目目录、写作素材目录或本主体具体资料内检索，不允许从资料库上级目录递归读取')
    if target!=root and root not in target.parents:return
    relative=target.relative_to(root).parts
    if len(relative)<2 or relative[0] not in ('files','parse'):
        raise BusinessError(409,'请通过本项目公司资料检索定位具体原件')
    file_name=relative[1]
    rows=read('SELECT k.id,a.revision,a.company_id FROM kb_items k JOIN company_assets a ON a.item_id=k.id WHERE k.file_name=? AND a.company_id=?',(file_name,require_confirmed(tid)['company_id']))
    if not rows:raise BusinessError(409,'该资料不属于本项目已确认的投标主体')
    return rows[0]
