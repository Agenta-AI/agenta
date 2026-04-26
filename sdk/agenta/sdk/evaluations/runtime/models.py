from typing import Any, Dict, List, Literal, Optional
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field

from agenta.sdk.models.evaluations import EvaluationStatus, Origin

StepType = Literal["input", "invocation", "annotation"]
SourceKind = Literal["query", "testset", "trace", "testcase", "direct"]
TopologyStatus = Literal["supported", "potential", "not_planned", "unsupported"]
DispatchKind = Literal[
    "batch_query",
    "batch_testset",
    "batch_invocation",
    "queue_traces",
    "queue_testcases",
    "live_query",
]


class EvaluationStep(BaseModel):
    model_config = ConfigDict(arbitrary_types_allowed=True)

    key: str
    type: StepType
    origin: Origin = "custom"
    references: Dict[str, Any] = Field(default_factory=dict)
    inputs: List[str] = Field(default_factory=list)


class ResolvedSourceItem(BaseModel):
    model_config = ConfigDict(arbitrary_types_allowed=True)

    kind: SourceKind
    step_key: str
    references: Dict[str, Any] = Field(default_factory=dict)
    trace_id: Optional[str] = None
    span_id: Optional[str] = None
    testcase_id: Optional[UUID] = None
    testcase: Optional[Any] = None
    trace: Optional[Any] = None
    inputs: Optional[Any] = None
    outputs: Optional[Any] = None


class ScenarioBinding(BaseModel):
    model_config = ConfigDict(arbitrary_types_allowed=True)

    scenario_id: UUID
    source: ResolvedSourceItem
    interval: Optional[int] = None
    timestamp: Optional[Any] = None


class PlannedCell(BaseModel):
    model_config = ConfigDict(arbitrary_types_allowed=True)

    run_id: UUID
    scenario_id: UUID
    step_key: str
    step_type: StepType
    origin: Origin
    repeat_idx: int
    status: EvaluationStatus
    should_execute: bool = False
    trace_id: Optional[str] = None
    span_id: Optional[str] = None
    testcase_id: Optional[UUID] = None
    error: Optional[Dict[str, Any]] = None


class ExecutionPlan(BaseModel):
    model_config = ConfigDict(arbitrary_types_allowed=True)

    run_id: UUID
    cells: List[PlannedCell]

    @property
    def executable_cells(self) -> List[PlannedCell]:
        return [cell for cell in self.cells if cell.should_execute]


class TopologyDecision(BaseModel):
    status: TopologyStatus
    label: str
    reason: str
    dispatch: Optional[DispatchKind] = None


class WorkflowExecutionRequest(BaseModel):
    """Runner-agnostic request for an application or evaluator step."""

    model_config = ConfigDict(arbitrary_types_allowed=True)

    step: EvaluationStep
    cell: PlannedCell
    source: ResolvedSourceItem
    revision: Any
    parameters: Optional[Any] = None
    references: Dict[str, Any] = Field(default_factory=dict)
    links: Optional[Dict[str, Any]] = None
    upstream_trace: Optional[Any] = None
    upstream_outputs: Optional[Any] = None


class WorkflowExecutionResult(BaseModel):
    """Normalized result produced by any workflow runner adapter."""

    model_config = ConfigDict(arbitrary_types_allowed=True)

    status: EvaluationStatus
    trace_id: Optional[str] = None
    span_id: Optional[str] = None
    hash_id: Optional[str] = None
    outputs: Optional[Any] = None
    trace: Optional[Any] = None
    error: Optional[Dict[str, Any]] = None


class ResultLogRequest(BaseModel):
    """Runner-agnostic request for persisting a planned result cell."""

    model_config = ConfigDict(arbitrary_types_allowed=True)

    cell: PlannedCell
    trace_id: Optional[str] = None
    span_id: Optional[str] = None
    testcase_id: Optional[UUID] = None
    error: Optional[Dict[str, Any]] = None
