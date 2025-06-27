from itertools import chain
from typing import Optional, List, Any, Dict

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

    class Config(Identifier.Config, Lifecycle.Config):
        json_encoders: Dict[Any, Any] = dict(
            chain(
                Identifier.Config.json_encoders.items(),
                Lifecycle.Config.json_encoders.items(),
            )
        )


class EvaluatorRequest(BaseModel):
    evaluator: Evaluator


class EvaluatorQuery(BaseModel):
    flags: Optional[EvaluatorFlags] = None
    meta: Optional[Meta] = None


class EvaluatorQueryRequest(BaseModel):
    evaluator: EvaluatorQuery


class EvaluatorResponse(BaseModel):
    count: int = 0
    evaluator: Optional[Evaluator] = None


class EvaluatorsResponse(BaseModel):
    count: int = 0
    evaluator: List[Evaluator] = []
