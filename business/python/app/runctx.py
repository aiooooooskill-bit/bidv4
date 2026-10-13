from dataclasses import dataclass
from contextvars import ContextVar
@dataclass(frozen=True)
class ToolContext:
    conversation_id: str
    run_id: str
    task_id: str | None
_context = ContextVar('tool_context', default=None)
def set_run(cid, rid, task_id=None): _context.set(ToolContext(cid,rid,task_id))
def current_run(): return _context.get()
def clear_run(): _context.set(None)
