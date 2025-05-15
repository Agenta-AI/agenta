from typing import Optional, List

from pydantic import BaseModel

from oss.src.core.shared.dtos import (
    Identifier,
    Slug,
    Lifecycle,
    Metadata,
    Header,
)

from oss.src.core.workflows.dtos import (
    WorkflowData,
    WorkflowFlags,
)


class Evaluator(Identifier, Slug, Lifecycle, Header):
    flags: Optional[WorkflowFlags] = None
    metadata: Optional[Metadata] = None
    data: Optional[WorkflowData] = None


class EvaluatorRequest(BaseModel):
    evaluator: Evaluator


class EvaluatorQueryRequest(BaseModel):
    flags: Optional[WorkflowFlags] = None
    metadata: Metadata


class EvaluatorResponse(BaseModel):
    count: int
    evaluator: Optional[Evaluator] = None


class EvaluatorsResponse(BaseModel):
    count: int
    evaluator: List[Evaluator] = []
