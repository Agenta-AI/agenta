from typing import Optional, List

from pydantic import BaseModel

from oss.src.core.shared.dtos import (
    Identifier,
    Slug,
    Lifecycle,
    Meta,
    Header,
)

from oss.src.core.workflows.dtos import (
    WorkflowData,
    WorkflowFlags,
)


class EvaluatorFlags(WorkflowFlags):
    def __init__(self, **data):
        data["is_evaluator"] = True
        super().__init__(**data)


class Evaluator(Identifier, Slug, Lifecycle, Header):
    flags: Optional[EvaluatorFlags] = None
    meta: Optional[Meta] = None
    data: Optional[WorkflowData] = None


class EvaluatorRequest(BaseModel):
    evaluator: Evaluator


class EvaluatorQuery(BaseModel):
    flags: Optional[EvaluatorFlags] = None
    meta: Optional[Meta] = None


class EvaluatorQueryRequest(BaseModel):
    evaluator: EvaluatorQuery


class EvaluatorResponse(BaseModel):
    count: int
    evaluator: Optional[Evaluator] = None


class EvaluatorsResponse(BaseModel):
    count: int
    evaluator: List[Evaluator] = []
