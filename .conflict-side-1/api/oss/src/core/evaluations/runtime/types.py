from typing import Any, Dict, List, Literal, Optional
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field

# The evaluation engine lives in the SDK and owns these runtime types. The API
# imports them DIRECTLY (same class identity, no API-side copy) so there is no
# duplication and no SDK<->API conversion at the seam. Only the API-only shapes
# below (ingest specs, run-slice ops, summaries) are declared here.
from agenta.sdk.evaluations.runtime.models import (
    Dispatch,
    DispatchMode,
    DispatchSource,
    EvaluationStep,
    ExecutionPlan,
    PlannedCell,
    ResolvedSourceItem,
    ScenarioBinding,
    SourceKind,
    StepType,
    TopologyDecision,
    TopologyStatus,
)

__all__ = [
    # Re-exported engine types (defined in the SDK).
    "Dispatch",
    "DispatchMode",
    "DispatchSource",
    "EvaluationStep",
    "ExecutionPlan",
    "PlannedCell",
    "ResolvedSourceItem",
    "ScenarioBinding",
    "SourceKind",
    "StepType",
    "TopologyDecision",
    "TopologyStatus",
    # API-only runtime types.
    "SourceBatchKind",
    "RuntimeModel",
    "InputSourceSpec",
    "ResolvedSourceBatch",
    "ResolvedTestsetInputSpec",
    "RunSlice",
    "RunProbeSummary",
    "ProcessSummary",
]


SourceBatchKind = Literal[
    "traces",
    "testcases",
]


class RuntimeModel(BaseModel):
    model_config = ConfigDict(arbitrary_types_allowed=True)


class InputSourceSpec(RuntimeModel):
    kind: SourceKind
    step_key: str

    references: Dict[str, Any] = Field(default_factory=dict)


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


class ProcessSummary(RuntimeModel):
    created: int = 0
    reused: int = 0
    pending: int = 0
    failed: int = 0
    skipped: int = 0
