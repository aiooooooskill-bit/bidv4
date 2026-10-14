"""Strict model-facing review payload; citations are resolved by the review service."""
from typing import Literal
from pydantic import BaseModel, ConfigDict, Field

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
    title: str = Field(min_length=1)
    explanation: str = Field(min_length=1)
    suggestion: str = Field(min_length=1)

class Report(StrictModel):
    summary: str = Field(min_length=1)
    requirements: list[Requirement] = Field(min_length=1)
    issues: list[Issue]
    limitations: list[str] = Field(min_length=1)
