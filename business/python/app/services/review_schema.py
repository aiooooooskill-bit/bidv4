"""Strict model-facing review payload; citations are resolved by the review service."""
import re
from typing import Annotated, Literal
from pydantic import AfterValidator, BaseModel, ConfigDict, Field

def plain_item(text: str) -> str:
    if any(token in text for token in ('\n', '\r', r'\n', r'\r')) or re.match(r'^\s*(?:\d+[、)]|\d+\.\s*(?=\D)|[-*#]\s)', text):
        raise ValueError('条目须为单行纯文本，不含转义换行、Markdown或自带编号；编号由页面生成')
    return text

PlainItem = Annotated[str, Field(min_length=1), AfterValidator(plain_item)]

class StrictModel(BaseModel):
    model_config = ConfigDict(extra='forbid', str_strip_whitespace=True)

class Evidence(StrictModel):
    document_id: str
    start: int = Field(ge=1, strict=True)
    end: int = Field(ge=1, strict=True)

class Requirement(StrictModel):
    basis_id: str = Field(min_length=1)
    status: Literal['responded', 'missing', 'uncertain', 'conflict', 'informational']
    tender: list[Evidence] = Field(min_length=1)
    bid: list[Evidence]

RiskType = Literal['disqualification', 'scoring', 'confirmation', 'suggestion']

class Issue(StrictModel):
    id: str = Field(min_length=1)
    requirement_id: str
    risk_type: RiskType
    title: PlainItem
    explanation: str = Field(min_length=1)
    suggestion: str = Field(min_length=1)

class Report(StrictModel):
    requirements: list[Requirement] = Field(min_length=1)
    issues: list[Issue]
    limitations: list[PlainItem] = Field(min_length=1)
