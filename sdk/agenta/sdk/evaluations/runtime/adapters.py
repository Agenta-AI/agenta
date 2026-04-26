from typing import Any, Dict, Optional

from agenta.sdk.decorators.running import invoke_application, invoke_evaluator
from agenta.sdk.evaluations.preview.utils import fetch_trace_data
from agenta.sdk.evaluations.results import acreate as alog_result
from agenta.sdk.evaluations.runtime.models import (
    ResultLogRequest,
    WorkflowExecutionRequest,
    WorkflowExecutionResult,
)
from agenta.sdk.models.evaluations import EvaluationStatus
from agenta.sdk.models.workflows import (
    ApplicationServiceRequest,
    EvaluatorServiceRequest,
    WorkflowServiceRequestData,
)


class SdkLocalApplicationRunner:
    """SDK adapter for executing application steps through local decorators."""

    async def execute(
        self,
        request: WorkflowExecutionRequest,
    ) -> WorkflowExecutionResult:
        response = await invoke_application(
            request=ApplicationServiceRequest(
                data=WorkflowServiceRequestData(
                    revision=request.revision,
                    parameters=request.parameters,
                    testcase=request.source.testcase,
                    inputs=request.source.inputs,
                    trace=request.upstream_trace,
                    outputs=request.upstream_outputs,
                ),
                references=request.references,  # type: ignore[arg-type]
                links=request.links,  # type: ignore[arg-type]
            )
        )
        return _normalize_service_response(response)

    async def execute_batch(
        self,
        requests: list[WorkflowExecutionRequest],
    ) -> list[WorkflowExecutionResult]:
        return [await self.execute(request) for request in requests]


class SdkLocalEvaluatorRunner:
    """SDK adapter for executing evaluator steps through local decorators."""

    async def execute(
        self,
        request: WorkflowExecutionRequest,
    ) -> WorkflowExecutionResult:
        response = await invoke_evaluator(
            request=EvaluatorServiceRequest(
                version="2025.07.14",
                data=WorkflowServiceRequestData(
                    revision=request.revision,
                    parameters=request.parameters,
                    testcase=request.source.testcase,
                    inputs=request.source.inputs,
                    trace=request.upstream_trace,
                    outputs=request.upstream_outputs,
                ),
                references=request.references,  # type: ignore[arg-type]
                links=request.links,  # type: ignore[arg-type]
            )
        )
        return _normalize_service_response(response)

    async def execute_batch(
        self,
        requests: list[WorkflowExecutionRequest],
    ) -> list[WorkflowExecutionResult]:
        return [await self.execute(request) for request in requests]


class SdkResultLogger:
    """SDK adapter for persisting evaluation result cells."""

    async def log(self, request: ResultLogRequest) -> Any:
        cell = request.cell
        return await alog_result(
            run_id=cell.run_id,
            scenario_id=cell.scenario_id,
            step_key=cell.step_key,
            repeat_idx=cell.repeat_idx,
            trace_id=request.trace_id
            if request.trace_id is not None
            else cell.trace_id,
            testcase_id=(
                request.testcase_id
                if request.testcase_id is not None
                else cell.testcase_id
            ),
            error=request.error if request.error is not None else cell.error,
        )


class SdkTraceLoader:
    """SDK adapter for loading traces after local workflow execution."""

    def __init__(self, *, max_retries: int = 30, delay: float = 1.0):
        self.max_retries = max_retries
        self.delay = delay

    async def load(self, trace_id: str) -> Optional[Dict[str, Any]]:
        return await fetch_trace_data(
            trace_id,
            max_retries=self.max_retries,
            delay=self.delay,
        )


def _normalize_service_response(response: Any) -> WorkflowExecutionResult:
    if not response or not getattr(response, "data", None) or not response.trace_id:
        return WorkflowExecutionResult(
            status=EvaluationStatus.FAILURE,
            error={"message": "Missing or invalid workflow response"},
        )

    return WorkflowExecutionResult(
        status=EvaluationStatus.SUCCESS,
        trace_id=response.trace_id,
        span_id=getattr(response, "span_id", None),
        outputs=getattr(response.data, "outputs", None),
    )
