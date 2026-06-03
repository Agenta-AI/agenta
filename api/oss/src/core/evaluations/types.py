from typing import Optional, Dict, List, Union, Literal
from enum import Enum
from uuid import UUID
from datetime import datetime

from pydantic import BaseModel, field_validator, model_validator

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


class EvaluationMetricsInvalid(Exception):
    """Raised when a metric does not match any of the three valid shapes:
    global (scenario_id IS NULL, timestamp IS NULL),
    variational (scenario_id set, timestamp IS NULL),
    temporal (scenario_id IS NULL, timestamp set).
    """

    def __init__(
        self,
        message: str = "Metric does not match a valid global/variational/temporal shape.",
        run_id: Optional[UUID] = None,
        scenario_id: Optional[UUID] = None,
        timestamp: Optional[datetime] = None,
    ):
        super().__init__(message)

        self.message = message
        self.run_id = run_id
        self.scenario_id = scenario_id
        self.timestamp = timestamp

    def __str__(self):
        _message = self.message

        if self.run_id:
            _message += f" run_id={self.run_id}"
        if self.scenario_id:
            _message += f" scenario_id={self.scenario_id}"
        if self.timestamp:
            _message += f" timestamp={self.timestamp}"

        return _message


class DefaultQueueError(Exception):
    """Base exception for default-queue policy violations."""

    def __init__(self, message: str, queue_id: Optional[UUID] = None):
        super().__init__(message)
        self.message = message
        self.queue_id = queue_id

    def __str__(self):
        _message = self.message
        if self.queue_id:
            _message += f" queue_id={self.queue_id}"
        return _message


class DefaultQueueDataInvalid(DefaultQueueError):
    """Raised when a default queue carries scenario/step/assignment/batch filters."""

    def __init__(
        self,
        message: str = (
            "default queues cannot filter scenarios, steps, assignments, or batches"
        ),
        queue_id: Optional[UUID] = None,
    ):
        super().__init__(message, queue_id=queue_id)


class DefaultQueueDemotionForbidden(DefaultQueueError):
    """Raised when an edit attempts to demote a default queue."""

    def __init__(
        self,
        message: str = "default queues cannot be demoted",
        queue_id: Optional[UUID] = None,
    ):
        super().__init__(message, queue_id=queue_id)


class DefaultQueueDeletionForbidden(DefaultQueueError):
    """Raised when a hard delete targets a default queue (must be archived instead)."""

    def __init__(
        self,
        message: str = "default queues must be archived, not hard deleted",
        queue_id: Optional[UUID] = None,
    ):
        super().__init__(message, queue_id=queue_id)


class DefaultQueueArchiveForbidden(DefaultQueueError):
    """Raised when a user-facing archive targets a default queue.

    Default queues are system-managed: their archive/unarchive lifecycle is
    driven by run reconciliation, not by direct user action. (Internally,
    reconcile archives via `force=True`.)
    """

    def __init__(
        self,
        message: str = "default queues are system-managed and cannot be archived directly",
        queue_id: Optional[UUID] = None,
    ):
        super().__init__(message, queue_id=queue_id)


# - EVALUATION RUN -------------------------------------------------------------


class EvaluationRunFlags(BaseModel):
    is_live: bool = False  # Indicates if the run has live queries
    is_active: bool = False  # Indicates if the run is currently active
    is_closed: bool = False  # Indicates if the run is modifiable
    is_queue: bool = False  # Indicates active default queue + active human work
    is_cached: bool = False  # Indicates the run should reuse traces by hash
    is_split: bool = False  # Indicates repeats fan out at the application step
    #
    has_queries: bool = False  # Indicates if the run has query-backed inputs
    has_testsets: bool = False  # Indicates if the run has testset-backed inputs
    has_traces: bool = False  # Indicates if the run has direct trace inputs
    has_testcases: bool = False  # Indicates if the run has direct testcase inputs
    has_evaluators: bool = False  # Indicates if the run has evaluators
    #
    has_custom: bool = False  # Indicates if the run has custom evaluators
    has_human: bool = False  # Indicates if the run has human evaluators
    has_auto: bool = False  # Indicates if the run has auto evaluators


class EvaluationRunQueryFlags(BaseModel):
    is_live: Optional[bool] = None  # Indicates if the run has live queries
    is_active: Optional[bool] = None  # Indicates if the run is currently active
    is_closed: Optional[bool] = None  # Indicates if the run is modifiable
    is_queue: Optional[bool] = (
        None  # Indicates active default queue + active human work
    )
    is_cached: Optional[bool] = None  # Indicates the run should reuse traces by hash
    is_split: Optional[bool] = None  # Indicates repeats fan out at the application step
    #
    has_queries: Optional[bool] = None  # Indicates if the run has query-backed inputs
    has_testsets: Optional[bool] = (
        None  # Indicates if the run has testset-backed inputs
    )
    has_traces: Optional[bool] = None  # Indicates if the run has direct trace inputs
    has_testcases: Optional[bool] = (
        None  # Indicates if the run has direct testcase inputs
    )
    has_evaluators: Optional[bool] = None  # Indicates if the run has evaluators
    #
    has_custom: Optional[bool] = None  # Indicates if the run has custom evaluators
    has_human: Optional[bool] = None  # Indicates if the run has human evaluators
    has_auto: Optional[bool] = None  # Indicates if the run has auto evaluators


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


class EvaluationRunDataConcurrency(BaseModel):
    batch_size: Optional[int] = None
    max_retries: Optional[int] = None
    retry_delay: Optional[float] = None


class EvaluationRunData(BaseModel):
    steps: Optional[List[EvaluationRunDataStep]] = None
    repeats: Optional[int] = 1
    concurrency: Optional[EvaluationRunDataConcurrency] = None
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
    flags: Optional[EvaluationRunQueryFlags] = None  # type: ignore

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
    timestamps: Optional[Union[List[datetime], bool]] = None

    scenario_id: Optional[UUID] = None
    scenario_ids: Optional[Union[List[UUID], bool]] = None

    run_id: Optional[UUID] = None
    run_ids: Optional[List[UUID]] = None

    ids: Optional[List[UUID]] = None


class EvaluationMetricsRefresh(BaseModel):
    interval: Optional[int] = None

    timestamp: Optional[datetime] = None
    timestamps: Optional[List[datetime]] = None

    scenario_id: Optional[UUID] = None
    scenario_ids: Optional[List[UUID]] = None

    run_id: Optional[UUID] = None
    run_ids: Optional[List[UUID]] = None


class EvaluationMetricsSpecsRefresh(BaseModel):
    query: Optional[TracingQuery] = None
    specs: Optional[List[MetricSpec]] = None

    ids: Optional[List[UUID]] = None


# - EVALUATION QUEUE -----------------------------------------------------------


class EvaluationQueueFlags(BaseModel):
    is_sequential: bool = False
    is_default: bool = False


class EvaluationQueueQueryFlags(BaseModel):
    is_sequential: Optional[bool] = None
    is_default: Optional[bool] = None


class EvaluationQueueData(BaseModel):
    user_ids: Optional[List[List[UUID]]] = None
    scenario_ids: Optional[List[UUID]] = None
    step_keys: Optional[List[str]] = None
    batch_size: Optional[int] = None
    batch_offset: Optional[int] = None

    @field_validator("user_ids", mode="before")
    def validate_user_ids(cls, v):
        if v is None:
            return None

        return [
            [UUID(str(user_id)) for user_id in repeat_user_ids] for repeat_user_ids in v
        ]

    @field_validator("batch_size", mode="before")
    def validate_batch_size(cls, v):
        if v is None:
            return None
        if isinstance(v, bool) or not isinstance(v, int):
            raise ValueError("batch_size must be an integer greater than 0 or null")
        if v <= 0:
            raise ValueError("batch_size must be greater than 0")
        return v

    @field_validator("batch_offset", mode="before")
    def validate_batch_offset(cls, v):
        if v is None:
            return None
        if isinstance(v, bool) or not isinstance(v, int):
            raise ValueError(
                "batch_offset must be an integer greater than or equal to 0 or null"
            )
        if v < 0:
            raise ValueError("batch_offset must be greater than or equal to 0")
        return v


class EvaluationQueue(Version, Identifier, Lifecycle, Header, Metadata):
    flags: Optional[EvaluationQueueFlags] = None  # type: ignore

    status: Optional[EvaluationStatus] = EvaluationStatus.PENDING

    data: Optional[EvaluationQueueData] = None

    run_id: UUID


class EvaluationQueueCreate(Header, Metadata):
    version: str = CURRENT_VERSION

    flags: Optional[EvaluationQueueFlags] = None  # type: ignore

    status: Optional[EvaluationStatus] = EvaluationStatus.PENDING

    data: Optional[EvaluationQueueData] = None

    run_id: UUID


class EvaluationQueueEdit(Identifier, Header, Metadata):
    version: str = CURRENT_VERSION

    flags: Optional[EvaluationQueueFlags] = None  # type: ignore

    status: Optional[EvaluationStatus] = None

    data: Optional[EvaluationQueueData] = None


class EvaluationQueueQuery(Header, Metadata):
    flags: Optional[EvaluationQueueQueryFlags] = None  # type: ignore
    include_archived: Optional[bool] = None

    user_id: Optional[UUID] = None
    user_ids: Optional[List[UUID]] = None

    run_id: Optional[UUID] = None
    run_ids: Optional[List[UUID]] = None

    ids: Optional[List[UUID]] = None


class EvaluationQueueScenariosQuery(Identifier):
    user_id: Optional[UUID] = None
    user_ids: Optional[List[UUID]] = None


# - SIMPLE EVALUATION ----------------------------------------------------------


SimpleEvaluationFlags = EvaluationRunFlags

SimpleEvaluationQueryFlags = EvaluationRunQueryFlags

SimpleEvaluationStatus = EvaluationStatus


class SimpleEvaluationData(BaseModel):
    status: Optional[SimpleEvaluationStatus] = None

    query_steps: Optional[Target] = None
    testset_steps: Optional[Target] = None
    application_steps: Optional[Target] = None
    evaluator_steps: Optional[Target] = None

    repeats: Optional[int] = None
    concurrency: Optional[EvaluationRunDataConcurrency] = None


class SimpleEvaluation(Version, Identifier, Lifecycle, Header, Metadata):
    flags: Optional[SimpleEvaluationFlags] = None  # type: ignore

    data: Optional[SimpleEvaluationData] = None


class SimpleEvaluationCreate(Header, Metadata):
    version: str = CURRENT_VERSION

    flags: Optional[SimpleEvaluationFlags] = None  # type: ignore

    data: Optional[SimpleEvaluationData] = None


class SimpleEvaluationEdit(Identifier, Header, Metadata):
    version: str = CURRENT_VERSION

    flags: Optional[SimpleEvaluationFlags] = None  # type: ignore

    data: Optional[SimpleEvaluationData] = None


class SimpleEvaluationQuery(Header, Metadata):
    flags: Optional[SimpleEvaluationQueryFlags] = None  # type: ignore

    ids: Optional[List[UUID]] = None


# - SIMPLE QUEUE ---------------------------------------------------------------


class SimpleQueueKind(str, Enum):
    QUERIES = "queries"
    TESTSETS = "testsets"
    TRACES = "traces"
    TESTCASES = "testcases"


class SimpleQueueSettings(BaseModel):
    batch_size: Optional[int] = None
    """
    Number of scenarios per batch per user. When set, implies sequential (non-randomized)
    assignment. If None, scenarios are distributed randomly across users.
    """
    batch_offset: Optional[int] = None
    """
    Starting offset into the scenario list for batch assignment.
    """

    @field_validator("batch_size", mode="before")
    def validate_batch_size(cls, v):
        if v is None:
            return None
        if isinstance(v, bool) or not isinstance(v, int):
            raise ValueError("batch_size must be an integer greater than 0 or null")
        if v <= 0:
            raise ValueError("batch_size must be greater than 0")
        return v

    @field_validator("batch_offset", mode="before")
    def validate_batch_offset(cls, v):
        if v is None:
            return None
        if isinstance(v, bool) or not isinstance(v, int):
            raise ValueError(
                "batch_offset must be an integer greater than or equal to 0 or null"
            )
        if v < 0:
            raise ValueError("batch_offset must be greater than or equal to 0")
        return v


class SimpleQueueData(BaseModel):
    kind: Optional[SimpleQueueKind] = None

    queries: Optional[List[UUID]] = None
    """
    Optional source-backed queue input. Values are query revision IDs.
    When provided, the queue resolves those query revisions into trace IDs
    at creation time and preserves the query revision refs in the run steps.
    """

    testsets: Optional[List[UUID]] = None
    """
    Optional source-backed queue input. Values are testset revision IDs.
    When provided, the queue resolves those testset revisions into testcase IDs
    at creation time and preserves the testset revision refs in the run steps.
    """

    evaluators: Optional[Target] = None
    """
    The evaluators to run on each scenario.
    Either a list of evaluator revision UUIDs (origin-less; for a simple queue
    these default to 'human'), or a dict mapping evaluator revision UUID ->
    origin ('human' | 'auto' | 'custom'). A simple queue must resolve to at
    least one 'human' evaluator; an explicit dict of only non-human evaluators
    is rejected at the simple-queue endpoint (the underlying run itself has no
    such restriction).
    """

    repeats: Optional[int] = None

    assignments: Optional[List[List[UUID]]] = None
    """
    Ordered assignment of users per annotation repeat.
    Each inner list is the set of user UUIDs assigned to that repeat index.
    Example: [[user_a, user_b], [user_c]] means repeat 0 → user_a & user_b, repeat 1 → user_c.
    """

    settings: Optional[SimpleQueueSettings] = None
    """
    Optional distribution settings. Setting batch_size and/or batch_offset implies sequential
    (non-randomized) assignment. Omitting settings means randomized distribution.
    """

    @field_validator("assignments", mode="before")
    def validate_assignments(cls, v):
        if v is None:
            return None

        return [
            [UUID(str(user_id)) for user_id in repeat_user_ids] for repeat_user_ids in v
        ]

    @model_validator(mode="after")
    def validate_sources(self):
        has_kind = self.kind is not None
        has_queries = bool(self.queries)
        has_testsets = bool(self.testsets)

        if has_queries and has_testsets:
            raise ValueError("simple queue source must be either queries or testsets")

        if not has_kind and not has_queries and not has_testsets:
            raise ValueError("simple queue requires kind, queries, or testsets")

        if has_queries and self.kind not in (None, SimpleQueueKind.QUERIES):
            raise ValueError("query-backed queues must use kind='queries'")
        if has_testsets and self.kind not in (None, SimpleQueueKind.TESTSETS):
            raise ValueError("testset-backed queues must use kind='testsets'")
        if self.kind == SimpleQueueKind.QUERIES and not has_queries:
            raise ValueError("kind='queries' requires query sources")
        if self.kind == SimpleQueueKind.TESTSETS and not has_testsets:
            raise ValueError("kind='testsets' requires testset sources")

        # Simple-queue constraint (endpoint-only, not a run-layer rule): a queue
        # is human work, so it must resolve to at least one human evaluator.
        # An evaluator is human when it is origin-less (defaults to human at
        # build time) or explicitly origin="human". So:
        #   - a bare list is all origin-less -> always valid.
        #   - an explicit dict is valid only if at least one value is "human";
        #     a dict with only non-human origins (any of auto/custom, or a mix
        #     of them) has no human evaluator and is rejected.
        # The underlying evaluation run has no such restriction.
        if isinstance(self.evaluators, dict) and self.evaluators:
            if not any(origin == "human" for origin in self.evaluators.values()):
                raise ValueError("simple queues must have at least one human evaluator")

        return self


class SimpleQueue(Identifier, Lifecycle, Header, Metadata):
    status: Optional[EvaluationStatus] = EvaluationStatus.PENDING

    data: Optional[SimpleQueueData] = None

    run_id: UUID


class SimpleQueueCreate(Header, Metadata):
    status: Optional[EvaluationStatus] = None

    data: Optional[SimpleQueueData] = None


class SimpleQueueQuery(Header, Metadata):
    kind: Optional[SimpleQueueKind] = None

    user_id: Optional[UUID] = None
    user_ids: Optional[List[UUID]] = None

    run_id: Optional[UUID] = None
    run_ids: Optional[List[UUID]] = None

    queue_ids: Optional[List[UUID]] = None


class SimpleQueueScenariosQuery(Identifier):
    user_id: Optional[UUID] = None
    user_ids: Optional[List[UUID]] = None
