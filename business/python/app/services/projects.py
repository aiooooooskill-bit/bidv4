from pydantic import BaseModel, Field
from .. import db
from .errors import BusinessError
from .page_flow import require_task
from .edit_guard import require_idle


class RenameBody(BaseModel):
    title: str = Field(min_length=1, max_length=200)
    previous_title: str


async def rename_project(tid: str, body: RenameBody):
    require_idle(tid)
    require_task(tid)
    title = body.title.strip()
    if not title:
        raise BusinessError(422, '项目名称不能为空')
    try:
        db.rename_task(tid, title, previous_title=body.previous_title)
    except ValueError as error:
        raise BusinessError(409, str(error)) from error
    return db.get_task(tid)
