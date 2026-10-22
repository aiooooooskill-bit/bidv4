"""DOCX修订的唯一参数契约；原生工具和业务执行共用Pydantic约束。"""
from typing import Annotated, Literal
from pydantic import BaseModel, ConfigDict, Field, TypeAdapter

Index = Annotated[int, Field(gt=0, strict=True)]
Nonempty = Annotated[str, Field(min_length=1)]

class Edit(BaseModel):
    model_config = ConfigDict(extra='forbid', strict=True)

class ParagraphReplace(Edit):
    para: Index
    action: Literal['replace']
    find: Nonempty
    text: str

class ParagraphInsert(Edit):
    para: Index
    action: Literal['insert_after']
    text: Nonempty
    style: str = ''

class ParagraphDelete(Edit):
    para: Index
    action: Literal['delete']

class CellReplace(Edit):
    table: Index
    row: Index
    col: Index
    action: Literal['replace']
    find: Nonempty
    text: str

class CellFill(Edit):
    table: Index
    row: Index
    col: Index
    action: Literal['fill']
    text: Nonempty

RevisionEdit = ParagraphReplace | ParagraphInsert | ParagraphDelete | CellReplace | CellFill
RevisionEdits = Annotated[list[RevisionEdit], Field(min_length=1)]
EDITS = TypeAdapter(RevisionEdits)
