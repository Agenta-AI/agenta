from typing import Optional, Dict, List, Union, Literal
from enum import Enum
from uuid import UUID
from datetime import datetime

from pydantic import BaseModel, field_validator

from oss.src.core.tracing.dtos import (
    MetricSpec,
    TracingQuery,
)

from oss.src.core.shared.dtos import (
    Version,
    Identifier,
    Lifecycle,
    Header,
    Metadata,
    Data,
    Reference,
    Link,
)

References = Dict[str, Reference]
Links = Dict[str, Link]

Type = Literal["input", "invocation", "annotation"]
Origin = Literal["custom", "human", "auto"]
Target = Union[List[UUID], Dict[UUID, Origin]]

CURRENT_VERSION = "2025-07-14"


class EvaluationStatus(str, Enum):
    PENDING = "pending"
    QUEUED = "queued"
    RUNNING = "running"
    SUCCESS = "success"
    FAILURE = "failure"
    ERRORS = "errors"
    CANCELLED = "cancelled"


class EvaluationClosedConflict(Exception):
    """Exception raised when trying to modify a closed evaluation."""

    def __init__(
        self,
        message: str = "Cannot modify a closed evaluation.",
        run_id: Optional[UUID] = None,
        scenario_id: Optional[UUID] = None,
        result_id: Optional[UUID] = None,
        metrics_id: Optional[UUID] = None,
    ):
        super().__init__(message)

        self.message = message
        self.run_id = run_id
        self.scenario_id = scenario_id
        self.result_id = result_id
        self.metrics_id = metrics_id

    def __str__(self):
        _message = self.message

        if self.run_id:
            _message += f" run_id={self.run_id}"
        if self.scenario_id:
            _message += f" scenario_id={self.scenario_id}"
        if self.result_id:
            _message += f" result_id={self.result_id}"
        if self.metrics_id:
            _message += f" metrics_id={self.metrics_id}"

        return _message


# - EVALUATION RUN -------------------------------------------------------------


class EvaluationRunFlags(BaseModel):
    is_closed: Optional[bool] = None  # Indicates if the run is modifiable
    is_live: Optional[bool] = None  # Indicates if the run has live queries
    is_active: Optional[bool] = None  # Indicates if the run is currently active


class EvaluationRunDataStepInput(BaseModel):
    key: str


class EvaluationRunDataStep(BaseModel):
    key: str
    type: Type
    origin: Origin
    references: Dict[str, Reference]
    inputs: Optional[List[EvaluationRunDataStepInput]] = None


class EvaluationRunDataMappingColumn(BaseModel):
    kind: str
    name: str


class EvaluationRunDataMappingStep(BaseModel):
    key: str
    path: str


class EvaluationRunDataMapping(BaseModel):
    column: EvaluationRunDataMappingColumn
    step: EvaluationRunDataMappingStep


class EvaluationRunData(BaseModel):
    steps: Optional[List[EvaluationRunDataStep]] = None
    repeats: Optional[int] = 1
    mappings: Optional[List[EvaluationRunDataMapping]] = None

    @field_validator("repeats")
    def set_repeats(cls, v):
        if v is None:
            return 1
        return v


class EvaluationRun(Version, Identifier, Lifecycle, Header, Metadata):
    flags: Optional[EvaluationRunFlags] = None  # type: ignore

    status: Optional[EvaluationStatus] = EvaluationStatus.PENDING

    data: Optional[EvaluationRunData] = None


class EvaluationRunCreate(Header, Metadata):
    version: str = CURRENT_VERSION

    flags: Optional[EvaluationRunFlags] = None  # type: ignore

    status: Optional[EvaluationStatus] = None

    data: Optional[EvaluationRunData] = None


class EvaluationRunEdit(Identifier, Header, Metadata):
    version: str = CURRENT_VERSION

    flags: Optional[EvaluationRunFlags] = None  # type: ignore

    status: Optional[EvaluationStatus] = None

    data: Optional[EvaluationRunData] = None


class EvaluationRunQuery(Header, Metadata):
    flags: Optional[EvaluationRunFlags] = None  # type: ignore

    status: Optional[EvaluationStatus] = None
    statuses: Optional[List[EvaluationStatus]] = None

    references: Optional[List[References]] = None

    ids: Optional[List[UUID]] = None


# - EVALUATION SCENARIO --------------------------------------------------------


class EvaluationScenario(Version, Identifier, Lifecycle, Metadata):
    status: Optional[EvaluationStatus] = EvaluationStatus.PENDING

    interval: Optional[int] = None
    timestamp: Optional[datetime] = None
    run_id: UUID


class EvaluationScenarioCreate(Metadata):
    version: str = CURRENT_VERSION

    status: Optional[EvaluationStatus] = None

    interval: Optional[int] = None
    timestamp: Optional[datetime] = None
    run_id: UUID


class EvaluationScenarioEdit(Identifier, Metadata):
    version: str = CURRENT_VERSION

    status: Optional[EvaluationStatus] = None


class EvaluationScenarioQuery(Metadata):
    status: Optional[EvaluationStatus] = None
    statuses: Optional[List[EvaluationStatus]] = None

    interval: Optional[int] = None
    intervals: Optional[List[int]] = None

    timestamp: Optional[datetime] = None
    timestamps: Optional[List[datetime]] = None

    run_id: Optional[UUID] = None
    run_ids: Optional[List[UUID]] = None

    ids: Optional[List[UUID]] = None


# - EVALUATION RESULT ----------------------------------------------------------


class EvaluationResult(Version, Identifier, Lifecycle, Metadata):
    hash_id: Optional[UUID] = None
    trace_id: Optional[str] = None
    testcase_id: Optional[UUID] = None
    error: Optional[Data] = None

    status: Optional[EvaluationStatus] = EvaluationStatus.PENDING

    interval: Optional[int] = None
    timestamp: Optional[datetime] = None
    repeat_idx: Optional[int] = 0
    step_key: str
    scenario_id: UUID
    run_id: UUID


class EvaluationResultCreate(Metadata):
    version: str = CURRENT_VERSION

    hash_id: Optional[UUID] = None
    trace_id: Optional[str] = None
    testcase_id: Optional[UUID] = None
    error: Optional[Data] = None

    status: Optional[EvaluationStatus] = None

    interval: Optional[int] = None
    timestamp: Optional[datetime] = None
    repeat_idx: Optional[int] = 0
    step_key: str
    scenario_id: UUID
    run_id: UUID


class EvaluationResultEdit(Identifier, Metadata):
    version: str = CURRENT_VERSION

    hash_id: Optional[UUID] = None
    trace_id: Optional[str] = None
    testcase_id: Optional[UUID] = None
    error: Optional[Data] = None

    status: Optional[EvaluationStatus] = None


class EvaluationResultQuery(Metadata):
    status: Optional[EvaluationStatus] = None
    statuses: Optional[List[EvaluationStatus]] = None

    interval: Optional[int] = None
    intervals: Optional[List[int]] = None

    timestamp: Optional[datetime] = None
    timestamps: Optional[List[datetime]] = None

    repeat_idx: Optional[int] = None
    repeat_idxs: Optional[List[int]] = None

    step_key: Optional[str] = None
    step_keys: Optional[List[str]] = None

    scenario_id: Optional[UUID] = None
    scenario_ids: Optional[List[UUID]] = None

    run_id: Optional[UUID] = None
    run_ids: Optional[List[UUID]] = None

    ids: Optional[List[UUID]] = None


# - EVALUATION METRICS ---------------------------------------------------------


class EvaluationMetrics(Version, Identifier, Lifecycle, Metadata):
    status: Optional[EvaluationStatus] = EvaluationStatus.PENDING

    data: Optional[Data] = None

    interval: Optional[int] = None
    timestamp: Optional[datetime] = None
    scenario_id: Optional[UUID] = None
    run_id: UUID


class EvaluationMetricsCreate(Metadata):
    version: str = CURRENT_VERSION

    status: Optional[EvaluationStatus] = None

    data: Optional[Data] = None

    interval: Optional[int] = None
    timestamp: Optional[datetime] = None
    scenario_id: Optional[UUID] = None
    run_id: UUID


class EvaluationMetricsEdit(Identifier, Metadata):
    version: str = CURRENT_VERSION

    status: Optional[EvaluationStatus] = None

    data: Optional[Data] = None


class EvaluationMetricsQuery(Metadata):
    status: Optional[EvaluationStatus] = None
    statuses: Optional[List[EvaluationStatus]] = None

    interval: Optional[int] = None
    intervals: Optional[List[int]] = None

    timestamp: Optional[datetime] = None
    timestamps: Optional[List[datetime]] = None

    scenario_id: Optional[UUID] = None
    scenario_ids: Optional[List[UUID]] = None

    run_id: Optional[UUID] = None
    run_ids: Optional[List[UUID]] = None

    ids: Optional[List[UUID]] = None


class EvaluationMetricsRefresh(BaseModel):
    query: Optional[TracingQuery] = None
    specs: Optional[List[MetricSpec]] = None

    ids: Optional[List[UUID]] = None


# - EVALUATION QUEUE -----------------------------------------------------------


class EvaluationQueueFlags(BaseModel):
    is_sequential: bool = False


class EvaluationQueueData(BaseModel):
    user_ids: Optional[List[List[UUID]]] = None
    scenario_ids: Optional[List[UUID]] = None
    step_keys: Optional[List[str]] = None


class EvaluationQueue(Version, Identifier, Lifecycle, Header, Metadata):
    flags: Optional[EvaluationQueueFlags] = None  # type: ignore

    status: Optional[EvaluationStatus] = EvaluationStatus.PENDING

    data: Optional[EvaluationQueueData] = None

    run_id: UUID


class EvaluationQueueCreate(Header, Metadata):
    version: str = CURRENT_VERSION

    flags: Optional[EvaluationQueueFlags] = None  # type: ignore

    status: Optional[EvaluationStatus] = None

    data: Optional[EvaluationQueueData] = None

    run_id: UUID


class EvaluationQueueEdit(Identifier, Header, Metadata):
    version: str = CURRENT_VERSION

    flags: Optional[EvaluationQueueFlags] = None  # type: ignore

    status: Optional[EvaluationStatus] = None

    data: Optional[EvaluationQueueData] = None


class EvaluationQueueQuery(Header, Metadata):
    flags: Optional[EvaluationQueueFlags] = None  # type: ignore

    user_id: Optional[UUID] = None
    user_ids: Optional[List[UUID]] = None

    run_id: Optional[UUID] = None
    run_ids: Optional[List[UUID]] = None

    ids: Optional[List[UUID]] = None


# - SIMPLE EVALUATION ----------------------------------------------------------


SimpleEvaluationFlags = EvaluationRunFlags

SimpleEvaluationStatus = EvaluationStatus


class SimpleEvaluationData(BaseModel):
    status: Optional[SimpleEvaluationStatus] = None

    query_steps: Optional[Target] = None
    testset_steps: Optional[Target] = None
    application_steps: Optional[Target] = None
    evaluator_steps: Optional[Target] = None

    repeats: Optional[int] = None


class SimpleEvaluation(Version, Identifier, Lifecycle, Header, Metadata):
    flags: Optional[SimpleEvaluationFlags] = None  # type: ignore

    data: Optional[SimpleEvaluationData] = None


class SimpleEvaluationCreate(Header, Metadata):
    version: str = CURRENT_VERSION

    flags: Optional[SimpleEvaluationFlags] = None  # type: ignore

    data: Optional[SimpleEvaluationData] = None

    jit: Optional[Dict[str, bool]] = None


class SimpleEvaluationEdit(Identifier, Header, Metadata):
    version: str = CURRENT_VERSION

    flags: Optional[SimpleEvaluationFlags] = None  # type: ignore

    data: Optional[SimpleEvaluationData] = None


class SimpleEvaluationQuery(Header, Metadata):
    flags: Optional[SimpleEvaluationFlags] = None  # type: ignore

    ids: Optional[List[UUID]] = None
