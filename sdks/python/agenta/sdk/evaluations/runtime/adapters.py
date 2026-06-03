from asyncio import Semaphore
from typing import Any, Dict, Optional

from agenta.sdk.decorators.running import invoke_application, invoke_evaluator
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


class SDKWorkflowRunner:
    """SDK adapter for executing workflow steps through local decorators.

    One runner for both runnable step kinds — invocation (application) and
    annotation (evaluator) — mirroring the API's single `APIWorkflowRunner`. It
    branches on `request.step.type`: an application step invokes the app
    decorator, an evaluator step the evaluator decorator. The two paths differ
    only in which decorator they call and the request envelope; the request
    DATA is built identically.
    """

    async def execute(
        self,
        request: WorkflowExecutionRequest,
    ) -> WorkflowExecutionResult:
        data = WorkflowServiceRequestData(
            revision=request.revision,
            parameters=request.parameters,
            testcase=request.source.testcase,
            inputs=request.source.inputs,
            trace=request.upstream_trace,
            outputs=request.upstream_outputs,
        )

        if request.step.type == "invocation":
            response = await invoke_application(
                request=ApplicationServiceRequest(
                    data=data,
                    references=request.references,  # type: ignore[arg-type]
                    links=request.links,  # type: ignore[arg-type]
                )
            )
        else:
            response = await invoke_evaluator(
                request=EvaluatorServiceRequest(
                    version="2025.07.14",
                    data=data,
                    references=request.references,  # type: ignore[arg-type]
                    links=request.links,  # type: ignore[arg-type]
                )
            )

        return _normalize_service_response(response)

    async def execute_batch(
        self,
        requests: list[WorkflowExecutionRequest],
        semaphore: Optional[Semaphore] = None,
    ) -> list[WorkflowExecutionResult]:
        return [await self.execute(request) for request in requests]


class CollectingResultLogger:
    """Result logger that COLLECTS cells in memory instead of writing each.

    The SDK local flow mirrors the API slice ops: execute locally, then write
    every finished cell in ONE `populate_slice` call. So during execution the
    engine's per-cell `log` must not hit the network — it just shapes the cell
    into a populate-ready dict and stashes it. `process_run_locally` drains
    `cells` afterward and bulk-populates. The returned dict is also what the
    engine remembers as the cell's value, so it round-trips into the populate
    payload with no further reshaping.
    """

    def __init__(self) -> None:
        self.cells: list[Dict[str, Any]] = []

    async def log(self, request: ResultLogRequest) -> Dict[str, Any]:
        cell = request.cell
        payload = dict(
            run_id=str(cell.run_id),
            scenario_id=str(cell.scenario_id),
            step_key=cell.step_key,
            repeat_idx=cell.repeat_idx,
            status=getattr(cell.status, "value", cell.status),
            trace_id=request.trace_id
            if request.trace_id is not None
            else cell.trace_id,
            testcase_id=str(
                request.testcase_id
                if request.testcase_id is not None
                else cell.testcase_id
            )
            if (request.testcase_id is not None or cell.testcase_id is not None)
            else None,
            error=request.error if request.error is not None else cell.error,
        )
        self.cells.append(payload)
        return payload


def _normalize_service_response(response: Any) -> WorkflowExecutionResult:
    # A response with no trace_id is treated as a FAILURE on purpose: the SDK
    # evaluation pipeline keys cache reuse, upstream-context links, and metric
    # provenance off the produced trace, so a step that returns outputs but no
    # trace cannot be wired into the rest of the run and is not a usable success.
    # (If a trace-free "outputs only" success mode is ever needed, branch here on
    # `response.data.outputs` before falling through to FAILURE.)
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
