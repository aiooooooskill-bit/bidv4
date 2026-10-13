"""工作树相对路径：跨平台输入，POSIX 业务键，原生文件系统落点。"""
import posixpath
from pathlib import Path, PureWindowsPath

from .artifact_store import work_dir


def normalize_work_path(path: str) -> str:
    if not path or '\0' in path or PureWindowsPath(path).drive or PureWindowsPath(path).root:
        raise ValueError('路径越界：须为 work/ 下的相对路径')
    relative = posixpath.normpath(path.replace('\\', '/'))
    if relative in ('.', '..') or relative.startswith('../'):
        raise ValueError('路径越界：须为 work/ 下的相对路径')
    return relative


def resolve_work_path(task_id: str, path: str) -> Path:
    root = work_dir(task_id).resolve()
    target = (root / normalize_work_path(path)).resolve()
    if not target.is_relative_to(root):
        raise ValueError('路径越界：须为 work/ 下的相对路径')
    return target


def relative_work_path(task_id: str, target: Path) -> str:
    return target.relative_to(work_dir(task_id).resolve()).as_posix()


def is_within(target: Path, directory: Path) -> bool:
    """结合文件系统身份判断，包含 macOS/Windows 的大小写及链接别名。"""
    directory = directory.resolve()
    return target.is_relative_to(directory) or (directory.is_dir() and any(
        parent.exists() and parent.samefile(directory) for parent in (target, *target.parents)))
