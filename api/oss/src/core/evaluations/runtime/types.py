from typing import Any, Dict, List, Literal, Optional
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field

from oss.src.core.evaluations.types import EvaluationStatus, Origin, Type

InputSourceKind = Literal[
    "query",
    "testset",
    "trace",
    "testcase",
    "direct",
]
SourceBatchKind = Literal[
    "traces",
    "testcases",
]
TopologyStatus = Literal[
    "supported",
    "potential",
    "not_planned",
    "unsupported",
]
DispatchSource = Literal[
    "query",
    "testset",
    "trace",
    "testcase",
]
DispatchMode = Literal[
    "live",
    "batch",
    "queue",
]


class Dispatch(BaseModel):
    source: DispatchSource
    mode: DispatchMode


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
    trace: Optional[Any] = None

    testcase_id: Optional[UUID] = None
    testcase: Optional[Any] = None

    inputs: Optional[Any] = None
    outputs: Optional[Any] = None


class ResolvedSourceBatch(RuntimeModel):
    kind: SourceBatchKind
    step_key: str

    trace_ids: List[str] = Field(default_factory=list)
    testcase_ids: List[UUID] = Field(default_factory=list)


class ResolvedTestsetInputSpec(RuntimeModel):
    step_key: str

    testset_revision: Any
    testcases: List[Any] = Field(default_factory=list)

    @property
    def testcases_data(self) -> List[Dict[str, Any]]:
        return [
            {**testcase.data, "testcase_id": str(testcase.id)}
            for testcase in self.testcases
        ]


class ScenarioBinding(RuntimeModel):
    source: ResolvedSourceItem

    scenario_id: UUID
    interval: Optional[int] = None
    timestamp: Optional[Any] = None


class EvaluationStep(RuntimeModel):
    key: str
    type: Type
    origin: Origin

    references: Dict[str, Any] = Field(default_factory=dict)

    inputs: List[str] = Field(default_factory=list)


class RunSlice(RuntimeModel):
    run_id: UUID

    scenario_ids: Optional[List[UUID]] = None
    step_keys: Optional[List[str]] = None
    repeat_idxs: Optional[List[int]] = None

    overwrite: bool = False


class RunProbeSummary(RuntimeModel):
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
    repeat_idx: int

    step_type: Type
    step_origin: Origin

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
    skipped: int = 0


class TopologyDecision(RuntimeModel):
    status: TopologyStatus
    label: str
    reason: str
    dispatch: Optional[Dispatch] = None
