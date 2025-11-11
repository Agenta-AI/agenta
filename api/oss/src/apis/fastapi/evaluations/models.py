from typing import Optional, List
from uuid import UUID

from pydantic import BaseModel

from fastapi import HTTPException

from oss.src.core.shared.dtos import Windowing

from oss.src.core.evaluations.types import (
    EvaluationRun,
    EvaluationRunCreate,
    EvaluationRunEdit,
    EvaluationRunQuery,
    EvaluationScenario,
    EvaluationScenarioCreate,
    EvaluationScenarioEdit,
    EvaluationScenarioQuery,
    EvaluationStep,
    EvaluationStepCreate,
    EvaluationStepEdit,
    EvaluationStepQuery,
    EvaluationMetric,
    EvaluationMetricCreate,
    EvaluationMetricEdit,
    EvaluationMetricQuery,
    EvaluationQueue,
    EvaluationQueueCreate,
    EvaluationQueueEdit,
    EvaluationQueueQuery,
)


class EvaluationClosedException(HTTPException):
    """Exception raised when trying to modify a closed evaluation."""

    def __init__(
        self,
        message: str = "Cannot modify a closed evaluation.",
        run_id: Optional[UUID] = None,
        scenario_id: Optional[UUID] = None,
        step_id: Optional[UUID] = None,
        metric_id: Optional[UUID] = None,
    ):
        details = dict(message=message)

        if run_id:
            details["run_id"] = str(run_id)
        if scenario_id:
            details["scenario_id"] = str(scenario_id)
        if step_id:
            details["step_id"] = str(step_id)
        if metric_id:
            details["metric_id"] = str(metric_id)

        super().__init__(status_code=409, detail=details)

        self.run_id = run_id
        self.scenario_id = scenario_id
        self.step_id = step_id
        self.metric_id = metric_id


# - EVALUATION RUN -------------------------------------------------------------


class EvaluationRunsCreateRequest(BaseModel):
    runs: List[EvaluationRunCreate]


class EvaluationRunEditRequest(BaseModel):
    run: EvaluationRunEdit


class EvaluationRunsEditRequest(BaseModel):
    runs: List[EvaluationRunEdit]


class EvaluationRunQueryRequest(BaseModel):
    run: EvaluationRunQuery
    include_archived: Optional[bool] = False
    windowing: Optional[Windowing] = None


class EvaluationRunIdsRequest(BaseModel):
    run_ids: List[UUID]


class EvaluationRunResponse(BaseModel):
    count: int = 0
    run: Optional[EvaluationRun] = None


class EvaluationRunsResponse(BaseModel):
    count: int = 0
    runs: List[EvaluationRun] = []


class EvaluationRunIdResponse(BaseModel):
    count: int = 0
    run_id: Optional[UUID] = None


class EvaluationRunIdsResponse(BaseModel):
    count: int = 0
    run_ids: List[UUID] = []


# - EVALUATION SCENARIO --------------------------------------------------------


class EvaluationScenariosCreateRequest(BaseModel):
    scenarios: List[EvaluationScenarioCreate]


class EvaluationScenarioEditRequest(BaseModel):
    scenario: EvaluationScenarioEdit


class EvaluationScenariosEditRequest(BaseModel):
    scenarios: List[EvaluationScenarioEdit]


class EvaluationScenarioQueryRequest(BaseModel):
    scenario: EvaluationScenarioQuery
    windowing: Optional[Windowing] = None


class EvaluationScenarioIdsRequest(BaseModel):
    scenario_ids: List[UUID]


class EvaluationScenarioResponse(BaseModel):
    count: int = 0
    scenario: Optional[EvaluationScenario] = None


class EvaluationScenariosResponse(BaseModel):
    count: int = 0
    scenarios: List[EvaluationScenario] = []


class EvaluationScenarioIdResponse(BaseModel):
    count: int = 0
    scenario_id: Optional[UUID] = None


class EvaluationScenarioIdsResponse(BaseModel):
    count: int = 0
    scenario_ids: List[UUID] = []


# - EVALUATION STEP ------------------------------------------------------------


class EvaluationStepsCreateRequest(BaseModel):
    steps: List[EvaluationStepCreate]


class EvaluationStepEditRequest(BaseModel):
    step: EvaluationStepEdit


class EvaluationStepsEditRequest(BaseModel):
    steps: List[EvaluationStepEdit]


class EvaluationStepQueryRequest(BaseModel):
    step: EvaluationStepQuery
    windowing: Optional[Windowing] = None


class EvaluationStepIdsRequest(BaseModel):
    step_ids: List[UUID]


class EvaluationStepResponse(BaseModel):
    count: int = 0
    step: Optional[EvaluationStep] = None


class EvaluationStepsResponse(BaseModel):
    count: int = 0
    steps: List[EvaluationStep] = []


class EvaluationStepIdResponse(BaseModel):
    count: int = 0
    step_id: Optional[UUID] = None


class EvaluationStepIdsResponse(BaseModel):
    count: int = 0
    step_ids: List[UUID] = []


# - EVALUATION METRIC ----------------------------------------------------------


class EvaluationMetricsCreateRequest(BaseModel):
    metrics: List[EvaluationMetricCreate]


class EvaluationMetricEditRequest(BaseModel):
    metric: EvaluationMetricEdit


class EvaluationMetricsEditRequest(BaseModel):
    metrics: List[EvaluationMetricEdit]


class EvaluationMetricQueryRequest(BaseModel):
    metric: EvaluationMetricQuery
    windowing: Optional[Windowing] = None


class EvaluationMetricIdsRequest(BaseModel):
    metric_ids: List[UUID]


class EvaluationMetricResponse(BaseModel):
    count: int = 0
    metric: Optional[EvaluationMetric] = None


class EvaluationMetricsResponse(BaseModel):
    count: int = 0
    metrics: List[EvaluationMetric] = []


class EvaluationMetricIdResponse(BaseModel):
    count: int = 0
    metric_id: Optional[UUID] = None


class EvaluationMetricIdsResponse(BaseModel):
    count: int = 0
    metric_ids: List[UUID] = []


# - EVALUATION QUEUE -----------------------------------------------------------


class EvaluationQueuesCreateRequest(BaseModel):
    queues: List[EvaluationQueueCreate]


class EvaluationQueueEditRequest(BaseModel):
    queue: EvaluationQueueEdit


class EvaluationQueuesEditRequest(BaseModel):
    queues: List[EvaluationQueueEdit]


class EvaluationQueueQueryRequest(BaseModel):
    queue: EvaluationQueueQuery
    windowing: Optional[Windowing] = None


class EvaluationQueueIdsRequest(BaseModel):
    queue_ids: List[UUID]


class EvaluationQueueResponse(BaseModel):
    count: int = 0
    queue: Optional[EvaluationQueue] = None


class EvaluationQueuesResponse(BaseModel):
    count: int = 0
    queues: List[EvaluationQueue] = []


class EvaluationQueueIdResponse(BaseModel):
    count: int = 0
    queue_id: Optional[UUID] = None


class EvaluationQueueIdsResponse(BaseModel):
    count: int = 0
    queue_ids: List[UUID] = []


class EvaluationQueueScenarioIdsResponse(BaseModel):
    count: int = 0
    scenario_ids: List[List[UUID]] = []


# ------------------------------------------------------------------------------
