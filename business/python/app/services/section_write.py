"""单节工具先改临时DOCX；来源核验后提交，失败恢复原文件与制作账本。"""
from contextvars import ContextVar
from copy import deepcopy
from datetime import datetime
from pathlib import Path
from tempfile import TemporaryDirectory
import re

from .. import artifact_store
from . import build_state, page_flow, source_usage

_active = ContextVar('section_write', default=None)


def destination(path):
    active = _active.get()
    if active is None:
        return path
    target, staged = active
    if path.resolve() != target:
        raise ValueError('单节写入目标发生变化，未保存')
    return staged


def execute(tid, relative, session, consumed_source, replace, operation):
    from ..tools.docx_ops import _dest_path, _docx_path_lock
    target, relative = _dest_path(tid, relative, must_exist=False)
    with TemporaryDirectory(prefix='.section-write-', dir=artifact_store.work_dir(tid)) as directory:
        staged = Path(directory) / target.name
        with _docx_path_lock(target):
            original = target.read_bytes() if target.is_file() else None
        if original is not None:
            staged.write_bytes(original)
        before_hash = page_flow.file_hash(staged) if staged.is_file() else None
        token = _active.set((target.resolve(), staged))
        try:
            result = operation()
        finally:
            _active.reset(token)
        if not staged.is_file() or page_flow.file_hash(staged) == before_hash or re.match(r'^\[[^\]]*失败\]', str(result)):
            return result
        # Existing multi-file writes take the same publication-lock -> DOCX-lock order.
        # No shared publication lock is held while the model tool builds/renders its draft.
        with artifact_store.write_lock(), _docx_path_lock(target):
            if (target.read_bytes() if target.is_file() else None) != original:
                raise ValueError('正文已由其他写入更新，本次临时改动未保存；请读取最新文件后重试')
            state_path = artifact_store.work_dir(tid) / 'body/.build-state.json'
            before_state = state_path.read_text() if state_path.is_file() else None
            value = build_state.read(tid)
            if consumed_source:
                source_usage.record_read_value(value, session, consumed_source)
            from .asset_usage import attach_reads
            # Validate prospective dependencies without publishing file or metadata.
            attach_reads(tid, deepcopy(value), relative, session, replace)
            restore = None
            removed_points = []
            try:
                target.parent.mkdir(parents=True, exist_ok=True)
                staged.replace(target)
                section = next((s for s in build_state.sections(tid) if s['path'] == relative), None)
                if section:
                    build_state._record_write_locked(tid, section, value, session, replace)
                elif consumed_source:
                    build_state.save(tid, value)
                if replace and original is not None:
                    points = target.with_name(target.name + '.restorepoints')
                    points.mkdir(parents=True, exist_ok=True)
                    restore = points / (datetime.now().strftime('%Y%m%d%H%M%S%f') + '.bak')
                    restore.write_bytes(original)
                    for old in sorted(points.glob('*.bak'))[:-artifact_store.RESTORE_KEEP]:
                        removed_points.append((old, old.read_bytes()))
                        old.unlink()
            except Exception:
                if original is None:
                    target.unlink(missing_ok=True)
                else:
                    staged.write_bytes(original)
                    staged.replace(target)
                if before_state is None:
                    state_path.unlink(missing_ok=True)
                else:
                    artifact_store._atomic_write(state_path, before_state)
                for old, content in removed_points:
                    old.write_bytes(content)
                if restore is not None:
                    restore.unlink(missing_ok=True)
                raise
        return result
