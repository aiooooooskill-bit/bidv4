"""SQLite业务数据：任务、产物版本、知识/素材索引及Word版式默认项。Agent会话与动作由dsh和页面动作回执管理。"""
import json
import logging
import sqlite3
import uuid
from datetime import datetime, timezone
from .config import app_db_path
logger = logging.getLogger(__name__)
_SCHEMA = """

CREATE TABLE IF NOT EXISTS tasks(
  id TEXT PRIMARY KEY, title TEXT NOT NULL,
  progress_note TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL);

CREATE TABLE IF NOT EXISTS app_settings(
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS artifact_index(
  artifact_id TEXT PRIMARY KEY,
  task_id TEXT,
  conversation_id TEXT,
  kind TEXT NOT NULL, schema_id TEXT NOT NULL, schema_version INTEGER NOT NULL,
  cardinality TEXT NOT NULL, display_name TEXT NOT NULL,
  content_path TEXT NOT NULL,
  content_seq INTEGER NOT NULL DEFAULT 1,
  updated_at TEXT NOT NULL,
  last_run_id TEXT, last_thread_id TEXT);

CREATE TABLE IF NOT EXISTS kb_items(
  id TEXT PRIMARY KEY,
  file_name TEXT NOT NULL,
  file_hash TEXT NOT NULL,
  title TEXT NOT NULL,
  ext TEXT NOT NULL,
  doc_type TEXT,
  parse_status TEXT NOT NULL DEFAULT 'pending',
  extract_status TEXT NOT NULL DEFAULT 'pending',
  review_status TEXT NOT NULL DEFAULT 'pending_review',
  suggested_metadata TEXT,
  business_metadata TEXT,
  check_result TEXT,
  progress TEXT,
  error TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS companies(
 id TEXT PRIMARY KEY, name TEXT NOT NULL, credit_code TEXT NOT NULL DEFAULT '',
 note TEXT NOT NULL DEFAULT '', profile TEXT NOT NULL DEFAULT '{}',
 revision INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS representatives(
 id TEXT PRIMARY KEY, company_id TEXT NOT NULL REFERENCES companies(id),
 name TEXT NOT NULL, title TEXT NOT NULL DEFAULT '', phone TEXT NOT NULL DEFAULT '',
 email TEXT NOT NULL DEFAULT '', note TEXT NOT NULL DEFAULT '', revision INTEGER NOT NULL DEFAULT 1);
CREATE TABLE IF NOT EXISTS company_assets(
 item_id TEXT PRIMARY KEY REFERENCES kb_items(id) ON DELETE CASCADE,
 company_id TEXT REFERENCES companies(id), revision INTEGER NOT NULL DEFAULT 0,
 corrected_text TEXT);
CREATE TABLE IF NOT EXISTS project_bidder(
 task_id TEXT PRIMARY KEY REFERENCES tasks(id) ON DELETE CASCADE,
 company_id TEXT NOT NULL REFERENCES companies(id), signer_id TEXT NOT NULL,
 sign_date TEXT NOT NULL, snapshot TEXT NOT NULL, revision INTEGER NOT NULL DEFAULT 1);
CREATE VIRTUAL TABLE IF NOT EXISTS kb_segments USING fts5(
  body, item_id UNINDEXED, section_path UNINDEXED, material_id UNINDEXED,
  line_start UNINDEXED, line_end UNINDEXED, page_start UNINDEXED);
CREATE TABLE IF NOT EXISTS mt_files(
  id TEXT PRIMARY KEY,
  file_name TEXT NOT NULL,
  file_hash TEXT NOT NULL,
  parse_status TEXT NOT NULL DEFAULT 'pending',
  error TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS mt_blocks(
  id TEXT PRIMARY KEY,
  file_id TEXT NOT NULL,
  title TEXT NOT NULL,
  note TEXT NOT NULL DEFAULT '',
  ranges TEXT NOT NULL,
  chars INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  use_count INTEGER NOT NULL DEFAULT 0,
  last_used_at TEXT);
"""
_SCHEMA_INDEXES = """

CREATE INDEX IF NOT EXISTS idx_artifact_index_scope
  ON artifact_index(task_id, conversation_id, kind, schema_id, schema_version);

CREATE UNIQUE INDEX IF NOT EXISTS uq_kb_items_hash ON kb_items(file_hash);
CREATE INDEX IF NOT EXISTS idx_kb_items_review ON kb_items(review_status);
CREATE INDEX IF NOT EXISTS idx_mt_blocks_file ON mt_blocks(file_id);
"""

def _conn() -> sqlite3.Connection:
    app_db_path().parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(str(app_db_path()), isolation_level=None, check_same_thread=False, timeout=3.0)
    conn.row_factory = sqlite3.Row
    conn.execute('PRAGMA journal_mode=WAL;')
    conn.execute('PRAGMA foreign_keys=ON;')
    return conn

def init_db() -> None:
    """只初始化本项目当前Schema，不升级或导入历史数据库。"""
    conn = _conn()
    try:
        version = conn.execute('PRAGMA user_version').fetchone()[0]
        has_tables = conn.execute("SELECT 1 FROM sqlite_master WHERE type='table' AND name='tasks'").fetchone()
        if has_tables and version != 1:
            raise RuntimeError('数据库不是当前项目格式；不会自动迁移或清空数据')
        conn.executescript(_SCHEMA)
        conn.executescript(_SCHEMA_INDEXES)
        conn.execute('PRAGMA user_version = 1')
    finally:
        conn.close()

def _now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec='seconds')

def create_task(title: str, *, task_id: str | None=None) -> dict:
    title = (title or '').strip() or '新任务'
    tid = task_id or f't_{uuid.uuid4().hex[:12]}'
    now = _now()
    conn = _conn()
    try:
        conn.execute('INSERT INTO tasks(id, title, progress_note, created_at) VALUES (?,?,?,?)', (tid, title, '', now))
    finally:
        conn.close()
    return {'id': tid, 'title': title, 'progress_note': '', 'created_at': now}

def list_tasks() -> list[dict]:
    conn = _conn()
    try:
        rows = conn.execute('SELECT id, title, progress_note, created_at FROM tasks ORDER BY created_at DESC').fetchall()
    finally:
        conn.close()
    return [dict(r) for r in rows]

def get_task(tid: str) -> dict | None:
    conn = _conn()
    try:
        row = conn.execute('SELECT id, title, progress_note, created_at FROM tasks WHERE id=?', (tid,)).fetchone()
    finally:
        conn.close()
    return dict(row) if row else None

def rename_task(tid: str, title: str) -> dict:
    title = (title or '').strip()
    if not title:
        raise ValueError('任务名不能为空')
    conn = _conn()
    try:
        conn.execute('UPDATE tasks SET title=? WHERE id=?', (title, tid))
    finally:
        conn.close()
    return {'id': tid, 'title': title}

def update_task_progress(tid: str, note: str) -> None:
    """进度便签：任务白板，整体覆盖（last-write-wins），非版本化内容。"""
    conn = _conn()
    try:
        conn.execute('UPDATE tasks SET progress_note=? WHERE id=?', (note, tid))
    finally:
        conn.close()

def list_task_artifact_signals() -> dict[str, dict[str, str]]:
    """全部任务的产物信号：{task_id: {schema_id: 该 schema 最新 updated_at}}。

    供任务阶段批量推导（task_stage.py）——一条 GROUP BY 拿全量，避免逐任务
    查询；idx_artifact_index_scope 以 task_id 打头，此查询走其前缀。
    未归属任务的产物行（task_id NULL）不参与。
    """
    conn = _conn()
    try:
        rows = conn.execute('SELECT task_id, schema_id, MAX(updated_at) AS ts FROM artifact_index WHERE task_id IS NOT NULL GROUP BY task_id, schema_id').fetchall()
    finally:
        conn.close()
    out: dict[str, dict[str, str]] = {}
    for r in rows:
        out.setdefault(r['task_id'], {})[r['schema_id']] = r['ts']
    return out

def delete_task(tid: str) -> None:
    conn = _conn()
    try:
        conn.execute('DELETE FROM artifact_index WHERE task_id=?', (tid,))
        conn.execute('DELETE FROM tasks WHERE id=?', (tid,))
    finally:
        conn.close()

def get_setting(key: str) -> str | None:
    """读取Word版式默认项。"""
    conn = _conn()
    try:
        row = conn.execute('SELECT value FROM app_settings WHERE key=?', (key,)).fetchone()
    finally:
        conn.close()
    return row['value'] if row else None

def set_setting(key: str, value: str) -> None:
    conn = _conn()
    try:
        conn.execute('INSERT INTO app_settings(key, value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value', (key, value))
    finally:
        conn.close()
_INDEX_COLS = 'artifact_id, task_id, conversation_id, kind, schema_id, schema_version, cardinality, display_name, content_path, content_seq, updated_at, last_run_id, last_thread_id'
_NUM_INDEX_COLS = len(_INDEX_COLS.split(','))

def upsert_artifact_index(rec: dict) -> None:
    """写入或覆盖当前产物索引及内容版本。"""
    conn = _conn()
    try:
        conn.execute(f"INSERT OR REPLACE INTO artifact_index({_INDEX_COLS}) VALUES ({','.join('?' * _NUM_INDEX_COLS)})", (rec['artifact_id'], rec.get('task_id'), rec.get('conversation_id'), rec['kind'], rec['schema_id'], rec['schema_version'], rec['cardinality'], rec['display_name'], rec['content_path'], rec.get('content_seq', 1), rec['updated_at'], rec.get('last_run_id'), rec.get('last_thread_id')))
    finally:
        conn.close()

def find_artifact_index(kind: str, schema_id: str, schema_version: int, task_id: str | None=None, conversation_id: str | None=None) -> dict | None:
    """按归属找同契约现有产物（task-single upsert 用）。

    文件归任务：同契约在任务内唯一（task-single），conversation_id 仅作来源筛选
    （可选），不再作为作用域判别——process 稿与正式稿已合并为单一产物。
    """
    if task_id is None:
        return None
    where, args = ('task_id=?', [task_id])
    if conversation_id is not None:
        where += ' AND conversation_id=?'
        args.append(conversation_id)
    conn = _conn()
    try:
        row = conn.execute(f'SELECT {_INDEX_COLS} FROM artifact_index WHERE {where} AND kind=? AND schema_id=? AND schema_version=?', (*args, kind, schema_id, schema_version)).fetchone()
    finally:
        conn.close()
    return dict(row) if row else None

def list_artifact_index(task_id: str | None=None, conversation_id: str | None=None) -> list[dict]:
    """产物索引列表。任务过滤返回任务全部产物（不再按 conversation_id IS NULL 区分）；
    会话过滤（可选）按 provenance 筛出该会话产出的产物；无参 = 全部。
    """
    where, args = ('', [])
    if task_id is not None:
        where, args = ('WHERE task_id=?', [task_id])
    if conversation_id is not None:
        where += (' AND ' if where else 'WHERE ') + 'conversation_id=?'
        args.append(conversation_id)
    conn = _conn()
    try:
        rows = conn.execute(f'SELECT {_INDEX_COLS} FROM artifact_index {where} ORDER BY updated_at DESC, artifact_id DESC', args).fetchall()
    finally:
        conn.close()
    return [dict(r) for r in rows]

def delete_artifact_index(aid: str) -> None:
    conn = _conn()
    try:
        conn.execute('DELETE FROM artifact_index WHERE artifact_id=?', (aid,))
    finally:
        conn.close()

def get_artifact_index(aid: str) -> dict | None:
    conn = _conn()
    try:
        row = conn.execute(f'SELECT {_INDEX_COLS} FROM artifact_index WHERE artifact_id=?', (aid,)).fetchone()
    finally:
        conn.close()
    return dict(row) if row else None

def rebuild_artifact_index(manifests: list[dict], content_path_of) -> int:
    """同步磁盘产物包身份，保留现存内容版本及发布来源；删除已不存在的索引。"""
    cols = _INDEX_COLS.split(', ')
    conn = _conn()
    try:
        existing = {r['artifact_id']: dict(r) for r in conn.execute(f'SELECT {_INDEX_COLS} FROM artifact_index')}
        conn.execute('DELETE FROM artifact_index')
        rows = []
        for m in manifests:
            schema = m.get('schema', {})
            source = m.get('source') or {}
            rec = {'artifact_id': m['artifact_id'], 'task_id': m.get('task_id'), 'conversation_id': m.get('conversation_id'), 'kind': m['kind'], 'schema_id': schema.get('id', ''), 'schema_version': schema.get('version', 1), 'cardinality': m.get('cardinality', 'task-single'), 'display_name': m.get('display_name', ''), 'content_path': content_path_of(m), 'content_seq': 1, 'updated_at': m.get('created_at', _now()), 'last_run_id': source.get('run_id'), 'last_thread_id': source.get('thread_id')}
            prev = existing.pop(rec['artifact_id'], None)
            if prev is not None:
                for col in ('content_seq', 'updated_at', 'last_run_id', 'last_thread_id'):
                    rec[col] = prev[col]
            rows.append(tuple((rec[c] for c in cols)))
        conn.executemany(f"INSERT INTO artifact_index({_INDEX_COLS}) VALUES ({','.join('?' * _NUM_INDEX_COLS)})", rows)
    finally:
        conn.close()
    return len(rows)
_KB_ITEM_COLS = 'id, file_name, file_hash, title, ext, doc_type, parse_status, extract_status, review_status, suggested_metadata, business_metadata, check_result, progress, error, created_at, updated_at'

_KB_REVIEW_SELECT = ', '.join('k.' + col.strip() for col in _KB_ITEM_COLS.split(',')) + ', a.company_id, COALESCE(a.revision,0) AS revision, a.corrected_text'
_KB_REVIEW_FROM = 'kb_items k LEFT JOIN company_assets a ON a.item_id=k.id'

def kb_insert_item(file_name: str, file_hash: str, title: str, ext: str) -> dict:
    kid = f'kb_{uuid.uuid4().hex[:12]}'
    now = _now()
    conn = _conn()
    try:
        conn.execute('INSERT INTO kb_items(id, file_name, file_hash, title, ext, created_at, updated_at) VALUES(?,?,?,?,?,?,?)', (kid, file_name, file_hash, title, ext, now, now))
    finally:
        conn.close()
    return kb_get_item(kid) or {}

def kb_get_item(kid: str) -> dict | None:
    conn = _conn()
    try:
        row = conn.execute(f'SELECT {_KB_REVIEW_SELECT} FROM {_KB_REVIEW_FROM} WHERE k.id=?', (kid,)).fetchone()
    finally:
        conn.close()
    return dict(row) if row else None

def kb_get_item_by_hash(file_hash: str) -> dict | None:
    conn = _conn()
    try:
        row = conn.execute(f'SELECT {_KB_REVIEW_SELECT} FROM {_KB_REVIEW_FROM} WHERE file_hash=?', (file_hash,)).fetchone()
    finally:
        conn.close()
    return dict(row) if row else None

def kb_list_items(review_status: str | None=None, doc_type: str | None=None, q: str | None=None) -> list[dict]:
    """知识库条目列表：待确认置顶、其余按创建时间倒序；q 对 file_name/title ILIKE。"""
    sql = f'SELECT {_KB_REVIEW_SELECT} FROM {_KB_REVIEW_FROM}'
    where, args = ([], [])
    if review_status:
        where.append('review_status=?')
        args.append(review_status)
    if doc_type:
        where.append('doc_type=?')
        args.append(doc_type)
    if q:
        where.append('(file_name LIKE ? OR title LIKE ?)')
        args.extend([f'%{q}%', f'%{q}%'])
    if where:
        sql += ' WHERE ' + ' AND '.join(where)
    sql += " ORDER BY CASE review_status WHEN 'pending_review' THEN 0 ELSE 1 END, created_at DESC"
    conn = _conn()
    try:
        rows = conn.execute(sql, args).fetchall()
    finally:
        conn.close()
    return [dict(r) for r in rows]

def kb_update_item(kid: str, *, preserve_confirmed: bool=False, **fields) -> None:
    """Every job update participates in the same monotonic review revision."""
    allowed = {'title', 'doc_type', 'parse_status', 'extract_status', 'review_status', 'suggested_metadata', 'business_metadata', 'check_result', 'progress', 'error'}
    conn = _conn()
    try:
        conn.execute('BEGIN IMMEDIATE')
        current = conn.execute('SELECT review_status FROM kb_items WHERE id=?', (kid,)).fetchone()
        if not current:
            conn.rollback()
            return
        if preserve_confirmed and current['review_status'] == 'confirmed':
            for key in ('business_metadata', 'review_status', 'doc_type'):
                fields.pop(key, None)
        keys = [k for k in fields if k in allowed]
        if keys:
            sets = ', '.join(f'{k}=?' for k in keys)
            conn.execute(f'UPDATE kb_items SET {sets}, updated_at=? WHERE id=?', [fields[k] for k in keys] + [_now(), kid])
            conn.execute('INSERT INTO company_assets(item_id,revision) VALUES(?,1) ON CONFLICT(item_id) DO UPDATE SET revision=revision+1', (kid,))
        conn.commit()
    except BaseException:
        conn.rollback()
        raise
    finally:
        conn.close()

def kb_delete_item(kid: str) -> None:
    conn = _conn()
    try:
        conn.execute('BEGIN IMMEDIATE')
        try:
            conn.execute('DELETE FROM kb_items WHERE id=?', (kid,))
            conn.execute('DELETE FROM kb_segments WHERE item_id=?', (kid,))
            conn.execute('COMMIT')
        except Exception:
            conn.execute('ROLLBACK')
            raise
    finally:
        conn.close()

def kb_count_pending() -> int:
    conn = _conn()
    try:
        row = conn.execute("SELECT COUNT(*) AS n FROM kb_items WHERE review_status='pending_review'").fetchone()
    finally:
        conn.close()
    return int(row['n']) if row else 0

def kb_replace_segments(item_id: str, segments: list[dict], *, expected_revision: int | None=None) -> None:
    """重建某条目的全部检索段（先 DELETE 后 INSERT，幂等）。

    DELETE+INSERT 必须在同一事务：连接是 autocommit（isolation_level=None），
    两条语句各自提交会留出「段已清空、新版未入」的可见窗口——确认表单后
    立即检索的调用方恰好落进窗口就空手而归（test_confirm_metadata_flow
    偶发失败的根因；与入库管线/确认路径的线程并发无关也要保证）。

    段 dict 可带 material_id（素材段；普通段缺省 None）。
    """
    conn = _conn()
    try:
        conn.execute('BEGIN IMMEDIATE')
        try:
            if expected_revision is not None:
                current=conn.execute('SELECT revision FROM company_assets WHERE item_id=?',(item_id,)).fetchone()
                if (current['revision'] if current else 0)!=expected_revision:
                    conn.rollback();return
            conn.execute('DELETE FROM kb_segments WHERE item_id=?', (item_id,))
            conn.executemany('INSERT INTO kb_segments(body, item_id, section_path, material_id, line_start, line_end, page_start) VALUES(?,?,?,?,?,?,?)', [(s['body'], item_id, s.get('section_path'), s.get('material_id'), s.get('line_start'), s.get('line_end'), s.get('page_start')) for s in segments])
            conn.execute('COMMIT')
        except Exception:
            conn.execute('ROLLBACK')
            raise
    finally:
        conn.close()
_MT_FILE_COLS = 'id, file_name, file_hash, parse_status, error, created_at, updated_at'

def mt_insert_file(file_name: str, file_hash: str) -> dict:
    fid = f'mt_{uuid.uuid4().hex[:12]}'
    now = _now()
    conn = _conn()
    try:
        conn.execute('INSERT INTO mt_files(id, file_name, file_hash, created_at, updated_at) VALUES(?,?,?,?,?)', (fid, file_name, file_hash, now, now))
    finally:
        conn.close()
    return mt_get_file(fid) or {}

def mt_get_file(fid: str) -> dict | None:
    conn = _conn()
    try:
        row = conn.execute(f'SELECT {_MT_FILE_COLS} FROM mt_files WHERE id=?', (fid,)).fetchone()
    finally:
        conn.close()
    return dict(row) if row else None

def mt_get_file_by_hash(file_hash: str) -> dict | None:
    conn = _conn()
    try:
        row = conn.execute(f'SELECT {_MT_FILE_COLS} FROM mt_files WHERE file_hash=?', (file_hash,)).fetchone()
    finally:
        conn.close()
    return dict(row) if row else None

def mt_list_files() -> list[dict]:
    """素材文件列表（按创建时间倒序）。"""
    conn = _conn()
    try:
        rows = conn.execute(f'SELECT {_MT_FILE_COLS} FROM mt_files ORDER BY created_at DESC').fetchall()
    finally:
        conn.close()
    return [dict(r) for r in rows]

def mt_update_file(fid: str, **fields) -> None:
    """更新 mt_files 指定列（仅白名单列）+ updated_at。"""
    allowed = {'parse_status', 'error', 'file_name'}
    keys = [k for k in fields if k in allowed and (fields[k] is not None or k == 'error')]
    if not keys:
        return
    sets = ', '.join((f'{k}=?' for k in keys))
    args = [fields[k] for k in keys] + [_now(), fid]
    conn = _conn()
    try:
        conn.execute(f'UPDATE mt_files SET {sets}, updated_at=? WHERE id=?', args)
    finally:
        conn.close()

def mt_delete_file(fid: str) -> None:
    """删素材文件连带块与检索段（单事务不留孤儿）。"""
    conn = _conn()
    try:
        conn.execute('BEGIN IMMEDIATE')
        try:
            conn.execute('DELETE FROM mt_files WHERE id=?', (fid,))
            conn.execute('DELETE FROM mt_blocks WHERE file_id=?', (fid,))
            conn.execute('DELETE FROM kb_segments WHERE item_id=?', (fid,))
            conn.execute('COMMIT')
        except Exception:
            conn.execute('ROLLBACK')
            raise
    finally:
        conn.close()

def mt_replace_blocks(file_id: str, rows: list[dict]) -> None:
    """重建某素材文件的块行（先 DELETE 后 INSERT，幂等；与知识库段重建同款事务纪律）。

    rows dict：{id, title, note, ranges(JSON 字符串 [[s,e],…]), chars}。
    块 id 在 blocks.json 生命周期内稳定——重建时按 id 回填 created_at/use_count/
    last_used_at（引用打点不随同步丢失，created_at 也不再被刷成 now）。
    """
    now = _now()
    conn = _conn()
    try:
        conn.execute('BEGIN IMMEDIATE')
        try:
            keep: dict[str, tuple[str, int, str | None]] = {r['id']: (r['created_at'], r['use_count'], r['last_used_at']) for r in conn.execute('SELECT id, created_at, use_count, last_used_at FROM mt_blocks WHERE file_id=?', (file_id,)).fetchall()}
            conn.execute('DELETE FROM mt_blocks WHERE file_id=?', (file_id,))
            conn.executemany('INSERT INTO mt_blocks(id, file_id, title, note, ranges, chars, created_at, use_count, last_used_at) VALUES(?,?,?,?,?,?,?,?,?)', [(r['id'], file_id, r['title'], r.get('note') or '', r['ranges'], r.get('chars') or 0, keep.get(r['id'], (now, 0, None))[0], keep.get(r['id'], (now, 0, None))[1], keep.get(r['id'], (now, 0, None))[2]) for r in rows])
            conn.execute('COMMIT')
        except Exception:
            conn.execute('ROLLBACK')
            raise
    finally:
        conn.close()

def mt_touch_blocks(bids: list[str]) -> None:
    """素材块 AI 引用打点（use_count+1 / last_used_at=now；容错不抛）。"""
    ids = [b for b in bids if b]
    if not ids:
        return
    placeholders = ','.join(('?' for _ in ids))
    conn = _conn()
    try:
        conn.execute(f'UPDATE mt_blocks SET use_count=use_count+1, last_used_at=? WHERE id IN ({placeholders})', [_now(), *ids])
    except Exception:
        logger.exception('素材块引用打点失败：%s', ids)
    finally:
        conn.close()

def mt_list_blocks(file_id: str | None=None) -> list[dict]:
    """块列表（可按文件过滤；ranges 反序列化为 [[s,e],…]；按创建时间倒序）。"""
    sql = 'SELECT id, file_id, title, note, ranges, chars, created_at, use_count, last_used_at FROM mt_blocks'
    args: tuple = ()
    if file_id:
        sql += ' WHERE file_id=?'
        args = (file_id,)
    sql += ' ORDER BY created_at DESC'
    conn = _conn()
    try:
        rows = conn.execute(sql, args).fetchall()
    finally:
        conn.close()
    out = []
    for r in rows:
        d = dict(r)
        try:
            d['ranges'] = json.loads(d['ranges']) if d['ranges'] else []
        except ValueError:
            d['ranges'] = []
        out.append(d)
    return out

def mt_get_block(bid: str) -> dict | None:
    conn = _conn()
    try:
        row = conn.execute('SELECT id, file_id, title, note, ranges, chars, created_at, use_count, last_used_at FROM mt_blocks WHERE id=?', (bid,)).fetchone()
    finally:
        conn.close()
    if not row:
        return None
    d = dict(row)
    try:
        d['ranges'] = json.loads(d['ranges']) if d['ranges'] else []
    except ValueError:
        d['ranges'] = []
    return d

def mt_count_blocks() -> int:
    conn = _conn()
    try:
        row = conn.execute('SELECT COUNT(*) AS n FROM mt_blocks').fetchone()
    finally:
        conn.close()
    return int(row['n']) if row else 0

def mt_block_counts() -> dict[str, int]:
    """file_id → 块数（文件列表徽标，一次聚合查询）。"""
    conn = _conn()
    try:
        rows = conn.execute('SELECT file_id, COUNT(*) AS n FROM mt_blocks GROUP BY file_id').fetchall()
    finally:
        conn.close()
    return {r['file_id']: int(r['n']) for r in rows}

def kb_search_segments(match_expr: str, limit: int=8, *, domain: str | None=None, company_id: str='all', doc_type: str | None=None) -> list[dict]:
    conditions=['kb_segments MATCH ?'];args=[match_expr]
    if domain=='mt':conditions.append("item_id IN (SELECT id FROM mt_files)")
    if domain=='kb':
        conditions.append('item_id IN (SELECT id FROM kb_items)')
        if company_id!='all':
            if company_id=='unassigned':conditions.append('item_id NOT IN (SELECT item_id FROM company_assets WHERE company_id IS NOT NULL)')
            else:
                conditions.append('item_id IN (SELECT item_id FROM company_assets WHERE company_id=?)');args.append(company_id)
        if doc_type:conditions.append('item_id IN (SELECT id FROM kb_items WHERE doc_type=?)');args.append(doc_type)
    conn=_conn()
    try:
        rows=conn.execute('SELECT item_id,section_path,material_id,line_start,line_end,page_start,body,bm25(kb_segments) AS rank FROM kb_segments WHERE '+' AND '.join(conditions)+' ORDER BY rank LIMIT ?',[*args,limit]).fetchall()
        return [dict(r) for r in rows]
    finally:conn.close()

def recover_stale_kb() -> int:
    """启动对账：sidecar 被杀时残留的 parsing/running 条目置 failed（可手动重触发）。"""
    conn = _conn()
    try:
        cur = conn.execute("UPDATE kb_items SET parse_status='failed', progress=NULL, error=COALESCE(error, 'sidecar 中断，请重新触发'), updated_at=? WHERE parse_status IN ('pending','parsing')", (_now(),))
        n1 = cur.rowcount
        cur = conn.execute("UPDATE kb_items SET extract_status='failed', updated_at=? WHERE extract_status='running'", (_now(),))
        n2 = cur.rowcount
    finally:
        conn.close()
    return n1 + n2

def recover_stale_mt() -> int:
    """启动对账：素材文件残留 pending/parsing 置 failed（失败行有重试入口）。"""
    conn = _conn()
    try:
        cur = conn.execute("UPDATE mt_files SET parse_status='failed', error=COALESCE(error, '解析中断，请重试'), updated_at=? WHERE parse_status IN ('pending','parsing')", (_now(),))
        n = cur.rowcount
    finally:
        conn.close()
    return n
