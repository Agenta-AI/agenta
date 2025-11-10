from typing import Dict, List, Optional, Union, Literal, Callable, Any
from enum import Enum
from uuid import UUID
from datetime import datetime

from pydantic import BaseModel

from agenta.sdk.models.shared import (
    TraceID,
    SpanID,
    Link,
    Identifier,
    Slug,
    Version,
    Reference,
    Lifecycle,
    Header,
    Flags,
    Tags,
    Meta,
    Metadata,
    Data,
    Commit,
    AliasConfig,
    sync_alias,
)


# ------------------------------------------------------------------------------


Origin = Literal["custom", "human", "auto"]
# Target = Union[List[UUID], Dict[UUID, Origin], List[Callable]]
Target = Union[
    List[List[Dict[str, Any]]],  # testcases_data
    List[Callable],  # workflow_handlers
    List[UUID],  # entity_ids
    Dict[UUID, Origin],  # entity_ids with origins
]


# oss.src.core.evaluations.types


class EvaluationStatus(str, Enum):
    PENDING = "pending"
    QUEUED = "queued"
    RUNNING = "running"
    SUCCESS = "success"
    FAILURE = "failure"
    ERRORS = "errors"
    CANCELLED = "cancelled"


class EvaluationRunFlags(BaseModel):
    is_closed: Optional[bool] = None  # Indicates if the run is immutable
    is_live: Optional[bool] = None  # Indicates if the run is updated periodically
    is_active: Optional[bool] = None  # Indicates if the run is currently active


class SimpleEvaluationFlags(EvaluationRunFlags):
    pass


SimpleEvaluationStatus = EvaluationStatus


class SimpleEvaluationData(BaseModel):
    status: Optional[SimpleEvaluationStatus] = None

    query_steps: Optional[Target] = None
    testset_steps: Optional[Target] = None
    application_steps: Optional[Target] = None
    evaluator_steps: Optional[Target] = None

    repeats: Optional[int] = None


class EvaluationRun(BaseModel):
    id: UUID


class EvaluationScenario(BaseModel):
    id: UUID

    run_id: UUID


class EvaluationResult(BaseModel):
    id: UUID

    run_id: UUID
    scenario_id: UUID
    step_key: str

    testcase_id: Optional[UUID] = None
    trace_id: Optional[UUID] = None
    error: Optional[dict] = None

    flags: Optional[Dict[str, Any]] = None
    tags: Optional[Dict[str, Any]] = None
    meta: Optional[Dict[str, Any]] = None


class EvaluationMetrics(Identifier, Lifecycle):
    flags: Optional[Dict[str, Any]] = None
    tags: Optional[Dict[str, Any]] = None
    meta: Optional[Dict[str, Any]] = None

    status: Optional[EvaluationStatus] = None

    timestamp: Optional[datetime] = None
    interval: Optional[int] = None

    data: Optional[Data] = None

    scenario_id: Optional[UUID] = None

    run_id: UUID
