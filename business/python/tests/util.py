def init_env(tmp_path, monkeypatch, data_subdir="data"):
    monkeypatch.setenv("DATA_DIR", str(tmp_path/data_subdir))
    from app import db
    db.init_db();task=db.create_task("测试任务")
    return task,{'id':'dsh-test-session','task_id':task['id']}
