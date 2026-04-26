from typing import Any, Dict, List, Literal, Optional
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field

from oss.src.core.evaluations.types import EvaluationStatus, Origin, Type

InputSourceKind = Literal["query", "testset", "trace", "testcase", "direct"]
SourceBatchKind = Literal["traces", "testcases"]
TopologyStatus = Literal["supported", "potential", "not_planned", "unsupported"]
DispatchKind = Literal[
    "batch_query",
    "batch_testset",
    "batch_invocation",
    "queue_traces",
    "queue_testcases",
    "live_query",
]


class RuntimeModel(BaseModel):
    model_config = ConfigDict(arbitrary_types_allowed=True)


class InputSourceSpec(RuntimeModel):
    kind: InputSourceKind
    step_key: str
    references: Dict[str, Any] = Field(default_factory=dict)


class ResolvedSourceItem(RuntimeModel):
    kind: InputSourceKind
    step_key: str
    references: Dict[str, Any] = Field(default_factory=dict)
    trace_id: Optional[str] = None
    span_id: Optional[str] = None
    testcase_id: Optional[UUID] = None
    testcase: Optional[Any] = None
    trace: Optional[Any] = None
    inputs: Optional[Any] = None
    outputs: Optional[Any] = None


class ResolvedSourceBatch(RuntimeModel):
    kind: SourceBatchKind
    step_key: str
    trace_ids: List[str] = Field(default_factory=list)
    testcase_ids: List[UUID] = Field(default_factory=list)


class ResolvedTestsetInputSpec(RuntimeModel):
    step_key: str
    testset: Any
    testset_revision: Any
    testcases: List[Any] = Field(default_factory=list)
    testcases_data: List[Dict[str, Any]] = Field(default_factory=list)


class ScenarioBinding(RuntimeModel):
    scenario_id: UUID
    source: ResolvedSourceItem
    interval: Optional[int] = None
    timestamp: Optional[Any] = None


class EvaluationStep(RuntimeModel):
    key: str
    type: Type
    origin: Origin
    references: Dict[str, Any] = Field(default_factory=dict)
    inputs: List[str] = Field(default_factory=list)


class TensorSlice(RuntimeModel):
    run_id: UUID
    scenario_ids: Optional[List[UUID]] = None
    step_keys: Optional[List[str]] = None
    repeat_idxs: Optional[List[int]] = None


class TensorProbeSummary(RuntimeModel):
    existing_count: int = 0
    missing_count: int = 0
    success_count: int = 0
    failure_count: int = 0
    pending_count: int = 0
    any_count: int = 0


class PlannedCell(RuntimeModel):
    run_id: UUID
    scenario_id: UUID
    step_key: str
    step_type: Type
    origin: Origin
    repeat_idx: int
    status: EvaluationStatus
    should_execute: bool = False
    trace_id: Optional[str] = None
    span_id: Optional[str] = None
    testcase_id: Optional[UUID] = None
    error: Optional[Dict[str, Any]] = None


class ExecutionPlan(RuntimeModel):
    run_id: UUID
    cells: List[PlannedCell]

    @property
    def executable_cells(self) -> List[PlannedCell]:
        return [cell for cell in self.cells if cell.should_execute]


class ProcessSummary(RuntimeModel):
    created: int = 0
    reused: int = 0
    pending: int = 0
    failed: int = 0


class TopologyDecision(RuntimeModel):
    status: TopologyStatus
    label: str
    reason: str
    dispatch: Optional[DispatchKind] = None
