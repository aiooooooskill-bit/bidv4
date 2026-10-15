"""Kernel file locks shared by short-lived business tool processes."""
from contextlib import contextmanager
from hashlib import sha256
from pathlib import Path
import os
from filelock import FileLock
from .config import data_dir

@contextmanager
def file_lock(target: Path):
    directory = data_dir() / 'file-locks'
    directory.mkdir(parents=True, exist_ok=True)
    name = sha256(os.path.normcase(str(target.resolve())).encode()).hexdigest()
    with FileLock(directory / name):
        yield
