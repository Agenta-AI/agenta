from typing import Optional, Dict, List
from enum import Enum
from uuid import UUID
from datetime import datetime

from pydantic import BaseModel

from oss.src.core.shared.dtos import (
    Identifier,
    Lifecycle,
    Flags,
    Tags,
    Meta,
    Header,
    Data,
    Reference,
    Link,
)

References = Dict[str, Reference]
Links = Dict[str, Link]


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
        step_id: Optional[UUID] = None,
        metric_id: Optional[UUID] = None,
    ):
        super().__init__(message)

        self.message = message
        self.run_id = run_id
        self.scenario_id = scenario_id
        self.step_id = step_id
        self.metric_id = metric_id

    def __str__(self):
        _message = self.message

        if self.run_id:
            _message += f" run_id={self.run_id}"
        if self.scenario_id:
            _message += f" scenario_id={self.scenario_id}"
        if self.step_id:
            _message += f" step_id={self.step_id}"
        if self.metric_id:
            _message += f" metric_id={self.metric_id}"

        return _message


class EvaluationRunFlags(BaseModel):
    is_closed: Optional[bool] = None


class EvaluationRunData(BaseModel):
    steps: Optional[List[Data]] = None  # ?
    mappings: Optional[List[Data]] = None  # ?


class EvaluationRun(Identifier, Header, Lifecycle):
    flags: Optional[EvaluationRunFlags] = None
    tags: Optional[Tags] = None
    meta: Optional[Meta] = None

    status: Optional[EvaluationStatus] = None

    data: Optional[EvaluationRunData] = None


class EvaluationRunCreate(Header):
    tags: Optional[Tags] = None
    meta: Optional[Meta] = None

    status: Optional[EvaluationStatus] = EvaluationStatus.PENDING

    data: Optional[EvaluationRunData] = None


class EvaluationRunEdit(Identifier, Header):
    tags: Optional[Tags] = None
    meta: Optional[Meta] = None

    status: Optional[EvaluationStatus] = None

    data: Optional[EvaluationRunData] = None


class EvaluationRunQuery(BaseModel):
    flags: Optional[EvaluationRunFlags] = None
    tags: Optional[Tags] = None
    meta: Optional[Meta] = None

    status: Optional[EvaluationStatus] = None
    statuses: Optional[List[EvaluationStatus]] = None

    ids: Optional[List[UUID]] = None


# - EVALUATION SCENARIO --------------------------------------------------------


class EvaluationScenario(Identifier, Lifecycle):
    # flags: Optional[Flags] = None
    tags: Optional[Tags] = None
    meta: Optional[Meta] = None

    status: Optional[EvaluationStatus] = None

    run_id: Optional[UUID] = None
    run: Optional[EvaluationRun] = None


class EvaluationScenarioCreate(BaseModel):
    tags: Optional[Tags] = None
    meta: Optional[Meta] = None

    status: Optional[EvaluationStatus] = EvaluationStatus.PENDING

    run_id: Optional[UUID] = None


class EvaluationScenarioEdit(Identifier):
    tags: Optional[Tags] = None
    meta: Optional[Meta] = None

    status: Optional[EvaluationStatus] = None


class EvaluationScenarioQuery(BaseModel):
    # flags: Optional[Flags] = None
    tags: Optional[Tags] = None
    meta: Optional[Meta] = None

    status: Optional[EvaluationStatus] = None
    statuses: Optional[List[EvaluationStatus]] = None

    run_id: Optional[UUID] = None
    run_ids: Optional[List[UUID]] = None

    ids: Optional[List[UUID]] = None


# - EVALUATION STEP ------------------------------------------------------------


class EvaluationStep(Identifier, Lifecycle):
    # flags: Optional[Flags] = None
    tags: Optional[Tags] = None
    meta: Optional[Meta] = None

    status: Optional[EvaluationStatus] = None
    timestamp: Optional[datetime] = None

    key: str
    repeat_id: Optional[UUID] = None
    retry_id: Optional[UUID] = None

    hash_id: Optional[UUID] = None
    trace_id: Optional[str] = None
    testcase_id: Optional[UUID] = None
    error: Optional[Data] = None

    scenario_id: Optional[UUID] = None
    scenario: Optional[EvaluationScenario] = None

    run_id: Optional[UUID] = None
    run: Optional[EvaluationRun] = None


class EvaluationStepCreate(BaseModel):
    tags: Optional[Tags] = None
    meta: Optional[Meta] = None

    status: Optional[EvaluationStatus] = EvaluationStatus.PENDING

    key: str
    repeat_id: Optional[UUID] = None
    retry_id: Optional[UUID] = None

    hash_id: Optional[UUID] = None
    trace_id: Optional[str] = None
    testcase_id: Optional[UUID] = None
    error: Optional[Data] = None

    scenario_id: Optional[UUID] = None
    run_id: Optional[UUID] = None


class EvaluationStepEdit(Identifier):
    tags: Optional[Tags] = None
    meta: Optional[Meta] = None

    status: Optional[EvaluationStatus] = None

    hash_id: Optional[UUID] = None
    trace_id: Optional[str] = None
    testcase_id: Optional[UUID] = None
    error: Optional[Data] = None


class EvaluationStepQuery(BaseModel):
    # flags: Optional[Flags] = None
    tags: Optional[Tags] = None
    meta: Optional[Meta] = None

    key: Optional[str] = None
    keys: Optional[List[str]] = None
    repeat_id: Optional[UUID] = None
    repeat_ids: Optional[List[UUID]] = None
    retry_id: Optional[UUID] = None
    retry_ids: Optional[List[UUID]] = None

    status: Optional[EvaluationStatus] = None
    statuses: Optional[List[EvaluationStatus]] = None
    timestamp: Optional[datetime] = None

    run_id: Optional[UUID] = None
    run_ids: Optional[List[UUID]] = None
    scenario_id: Optional[UUID] = None
    scenario_ids: Optional[List[UUID]] = None

    ids: Optional[List[UUID]] = None


# - EVALUATION METRIC ----------------------------------------------------------


class EvaluationMetric(Identifier, Lifecycle):
    # flags: Optional[Flags] = None
    tags: Optional[Tags] = None
    meta: Optional[Meta] = None

    status: Optional[EvaluationStatus] = None

    data: Optional[Data] = None

    scenario_id: Optional[UUID] = None
    scenario: Optional[EvaluationScenario] = None

    run_id: Optional[UUID] = None
    run: Optional[EvaluationRun] = None


class EvaluationMetricCreate(BaseModel):
    tags: Optional[Tags] = None
    meta: Optional[Meta] = None

    status: Optional[EvaluationStatus] = EvaluationStatus.PENDING

    data: Optional[Data] = None

    scenario_id: Optional[UUID] = None
    run_id: Optional[UUID] = None


class EvaluationMetricEdit(Identifier):
    tags: Optional[Tags] = None
    meta: Optional[Meta] = None

    status: Optional[EvaluationStatus] = None

    data: Optional[Data] = None


class EvaluationMetricQuery(BaseModel):
    # flags: Optional[Flags] = None
    tags: Optional[Tags] = None
    meta: Optional[Meta] = None

    status: Optional[EvaluationStatus] = None
    statuses: Optional[List[EvaluationStatus]] = None

    scenario_id: Optional[UUID] = None
    scenario_ids: Optional[List[UUID]] = None
    run_id: Optional[UUID] = None
    run_ids: Optional[List[UUID]] = None

    ids: Optional[List[UUID]] = None
