"""Kernel file locks shared by short-lived business tool processes."""
from contextlib import contextmanager
from hashlib import sha256
from pathlib import Path
import fcntl
from .config import data_dir

@contextmanager
def file_lock(target: Path):
    directory = data_dir() / 'file-locks'
    directory.mkdir(parents=True, exist_ok=True)
    name = sha256(str(target.resolve()).encode()).hexdigest()
    with (directory / name).open('a+b') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        try:
            yield
        finally:
            fcntl.flock(lock, fcntl.LOCK_UN)
