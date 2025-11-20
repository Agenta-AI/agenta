from itertools import chain
from typing import Optional, List, Any, Dict

from pydantic import BaseModel

from oss.src.core.shared.dtos import (
    Identifier,
    Slug,
    Lifecycle,
    Header,
    Tags,
    Meta,
    Windowing,
    Reference,
)

from oss.src.core.workflows.dtos import (
    WorkflowRevisionData,
    WorkflowFlags,
)


class SimpleEvaluatorFlags(WorkflowFlags):
    def __init__(self, **data):
        data["is_evaluator"] = True

        super().__init__(**data)


class SimpleEvaluator(
    Identifier,
    Slug,
    Lifecycle,
    Header,
):
    flags: Optional[SimpleEvaluatorFlags] = None
    tags: Optional[Tags] = None
    meta: Optional[Meta] = None

    data: Optional[WorkflowRevisionData] = None


class SimpleEvaluatorCreate(
    Slug,
    Header,
):
    flags: Optional[SimpleEvaluatorFlags] = None
    tags: Optional[Tags] = None
    meta: Optional[Meta] = None

    data: Optional[WorkflowRevisionData] = None


class SimpleEvaluatorEdit(
    Identifier,
    Header,
):
    flags: Optional[SimpleEvaluatorFlags] = None
    tags: Optional[Tags] = None
    meta: Optional[Meta] = None

    data: Optional[WorkflowRevisionData] = None


class SimpleEvaluatorQuery(BaseModel):
    flags: Optional[SimpleEvaluatorFlags] = None
    tags: Optional[Tags] = None
    meta: Optional[Meta] = None


class SimpleEvaluatorCreateRequest(BaseModel):
    evaluator: SimpleEvaluatorCreate


class SimpleEvaluatorEditRequest(BaseModel):
    evaluator: SimpleEvaluatorEdit


class SimpleEvaluatorQueryRequest(BaseModel):
    evaluator: Optional[SimpleEvaluatorQuery] = None
    #
    evaluator_refs: Optional[List[Reference]] = None
    #
    include_archived: Optional[bool] = False
    #
    windowing: Optional[Windowing] = None


class SimpleEvaluatorResponse(BaseModel):
    count: int = 0
    evaluator: Optional[SimpleEvaluator] = None


class SimpleEvaluatorsResponse(BaseModel):
    count: int = 0
    evaluators: List[SimpleEvaluator] = []
