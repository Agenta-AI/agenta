from typing import Optional, List
from uuid import UUID

from pydantic import BaseModel, root_validator
from fastapi import HTTPException

from oss.src.core.shared.dtos import (
    Windowing,
)
from oss.src.core.evaluations.types import (
    EvaluationRun,
    EvaluationRunCreate,
    EvaluationRunEdit,
    EvaluationRunQuery,
    #
    EvaluationScenario,
    EvaluationScenarioCreate,
    EvaluationScenarioEdit,
    EvaluationScenarioQuery,
    #
    EvaluationResult,
    EvaluationResultCreate,
    EvaluationResultEdit,
    EvaluationResultQuery,
    #
    EvaluationMetrics,
    EvaluationMetricsCreate,
    EvaluationMetricsEdit,
    EvaluationMetricsQuery,
    #
    EvaluationQueue,
    EvaluationQueueCreate,
    EvaluationQueueEdit,
    EvaluationQueueQuery,
    #
    SimpleEvaluation,
    SimpleEvaluationCreate,
    SimpleEvaluationEdit,
    SimpleEvaluationQuery,
)


class EvaluationClosedException(HTTPException):
    """Exception raised when trying to modify a closed evaluation."""

    def __init__(
        self,
        message: str = "Cannot modify a closed evaluation.",
        run_id: Optional[UUID] = None,
        scenario_id: Optional[UUID] = None,
        result_id: Optional[UUID] = None,
        metrics_id: Optional[UUID] = None,
        queue_id: Optional[UUID] = None,
    ):
        details = dict(message=message)

        if run_id:
            details["run_id"] = str(run_id)
        if scenario_id:
            details["scenario_id"] = str(scenario_id)
        if result_id:
            details["result_id"] = str(result_id)
        if metrics_id:
            details["metrics_id"] = str(metrics_id)
        if queue_id:
            details["queue_id"] = str(queue_id)

        super().__init__(status_code=409, detail=details)

        self.run_id = run_id
        self.scenario_id = scenario_id
        self.result_id = result_id
        self.metrics_id = metrics_id
        self.queue_id = queue_id


# EVALUATION RUNS --------------------------------------------------------------


class EvaluationRunsCreateRequest(BaseModel):
    runs: List[EvaluationRunCreate]


class EvaluationRunEditRequest(BaseModel):
    run: EvaluationRunEdit


class EvaluationRunsEditRequest(BaseModel):
    runs: List[EvaluationRunEdit]


class EvaluationRunQueryRequest(BaseModel):
    run: Optional[EvaluationRunQuery] = None
    #
    windowing: Optional[Windowing] = None


class EvaluationRunIdsRequest(BaseModel):
    run_ids: List[UUID]


class EvaluationRunResponse(BaseModel):
    count: int = 0
    run: Optional[EvaluationRun] = None


class EvaluationRunsResponse(BaseModel):
    count: int = 0
    runs: List[EvaluationRun] = []
    windowing: Optional[Windowing] = None


class EvaluationRunIdResponse(BaseModel):
    count: int = 0
    run_id: Optional[UUID] = None


class EvaluationRunIdsResponse(BaseModel):
    count: int = 0
    run_ids: List[UUID] = []


# - EVALUATION SCENARIOS -------------------------------------------------------


class EvaluationScenariosCreateRequest(BaseModel):
    scenarios: List[EvaluationScenarioCreate]


class EvaluationScenarioEditRequest(BaseModel):
    scenario: EvaluationScenarioEdit


class EvaluationScenariosEditRequest(BaseModel):
    scenarios: List[EvaluationScenarioEdit]


class EvaluationScenarioQueryRequest(BaseModel):
    scenario: Optional[EvaluationScenarioQuery] = None
    #
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


# - EVALUATION RESULTS ---------------------------------------------------------


class EvaluationResultsCreateRequest(BaseModel):
    results: List[EvaluationResultCreate]


class EvaluationResultEditRequest(BaseModel):
    result: EvaluationResultEdit


class EvaluationResultsEditRequest(BaseModel):
    results: List[EvaluationResultEdit]


class EvaluationResultQueryRequest(BaseModel):
    result: Optional[EvaluationResultQuery] = None
    #
    windowing: Optional[Windowing] = None


class EvaluationResultIdsRequest(BaseModel):
    result_ids: List[UUID]


class EvaluationResultResponse(BaseModel):
    count: int = 0
    result: Optional[EvaluationResult] = None


class EvaluationResultsResponse(BaseModel):
    count: int = 0
    results: List[EvaluationResult] = []


class EvaluationResultIdResponse(BaseModel):
    count: int = 0
    result_id: Optional[UUID] = None


class EvaluationResultIdsResponse(BaseModel):
    count: int = 0
    result_ids: List[UUID] = []


# - EVALUATION METRICS ---------------------------------------------------------


class EvaluationMetricsCreateRequest(BaseModel):
    metrics: List[EvaluationMetricsCreate]


class EvaluationMetricsEditRequest(BaseModel):
    metrics: List[EvaluationMetricsEdit]


class EvaluationMetricsQueryRequest(BaseModel):
    metrics: Optional[EvaluationMetricsQuery] = None
    #
    windowing: Optional[Windowing] = None

    @root_validator(pre=True)
    def _accept_metric_alias(cls, values):
        if "metrics" not in values and "metric" in values:
            values["metrics"] = values["metric"]
        return values


class EvaluationMetricsIdsRequest(BaseModel):
    metrics_ids: List[UUID]


class EvaluationMetricsResponse(BaseModel):
    count: int = 0
    metrics: List[EvaluationMetrics] = []


class EvaluationMetricsIdsResponse(BaseModel):
    count: int = 0
    metrics_ids: List[UUID] = []


# - EVALUATION QUEUES ----------------------------------------------------------


class EvaluationQueuesCreateRequest(BaseModel):
    queues: List[EvaluationQueueCreate]


class EvaluationQueueEditRequest(BaseModel):
    queue: EvaluationQueueEdit


class EvaluationQueuesEditRequest(BaseModel):
    queues: List[EvaluationQueueEdit]


class EvaluationQueueQueryRequest(BaseModel):
    queue: Optional[EvaluationQueueQuery] = None
    #
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


# - SIMPLE EVALUATIONS ---------------------------------------------------------


class SimpleEvaluationCreateRequest(BaseModel):
    evaluation: SimpleEvaluationCreate


class SimpleEvaluationEditRequest(BaseModel):
    evaluation: SimpleEvaluationEdit


class SimpleEvaluationQueryRequest(BaseModel):
    evaluation: Optional[SimpleEvaluationQuery] = None
    #
    windowing: Optional[Windowing] = None


class SimpleEvaluationResponse(BaseModel):
    count: int = 0
    evaluation: Optional[SimpleEvaluation] = None


class SimpleEvaluationsResponse(BaseModel):
    count: int = 0
    evaluations: List[SimpleEvaluation] = []


class SimpleEvaluationIdResponse(BaseModel):
    count: int = 0
    evaluation_id: Optional[UUID] = None
