import os
from pathlib import Path
MAX_UPLOAD_BYTES=100*1024*1024
def data_dir(): return Path(os.environ['DATA_DIR']).resolve()
def app_db_path(): return data_dir()/'app.db'
def workspace_dir(): return data_dir()/'workspace'
def knowledge_dir(): return workspace_dir()/'knowledge'
def materials_dir(): return workspace_dir()/'materials'
def skills_source_dir(): return Path(__file__).parent/'skills'
