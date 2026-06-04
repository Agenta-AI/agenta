from asyncio import Semaphore, gather
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
        # Concurrent, semaphore-bounded — same shape as APIWorkflowRunner. The
        # engine passes a shared semaphore (from batch_size); honoring it here is
        # what makes a scenario's repeats/steps run concurrently instead of
        # serially.
        async def _guarded(
            request: WorkflowExecutionRequest,
        ) -> WorkflowExecutionResult:
            if semaphore is not None:
                async with semaphore:
                    return await self.execute(request)
            return await self.execute(request)

        return list(await gather(*(_guarded(request) for request in requests)))


class SDKResultSetter:
    """Result setter that WRITES each cell live, like the API's APIResultSetter.

    Aligns the SDK with the API persistence model: each finished cell is
    populated to the backend as the engine produces it (one `populate` call per
    cell), instead of collected and bulk-written after the slice. Writing live is
    what lets the engine's inline per-scenario metric refresh see persisted
    cells, so the SDK gets the SAME variational-inline + global-at-end refresh
    shape as the API. The returned dict is what the engine remembers as the
    cell's value.
    """

    def __init__(self, *, populate: Any) -> None:
        self._populate = populate

    async def set(self, request: ResultLogRequest) -> Dict[str, Any]:
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
        await self._populate(results=[payload])
        return payload


class SDKScenarioEditor:
    """Engine `edit_scenario` adapter — SDK peer of `APIScenarioEditor`.

    Bridges the engine's `(scenario, status)` contract to the SDK client's
    `aedit_scenario(scenario_id=, status=, tags=, meta=)`, carrying the
    scenario's tags/meta through like the API adapter. The injected `edit`
    client tolerates a run closed mid-flight (HTTP 409 -> None).
    """

    def __init__(self, *, edit: Any) -> None:
        self._edit = edit

    async def __call__(self, scenario: Any, status: Any) -> Any:
        return await self._edit(
            scenario_id=scenario.id,
            status=getattr(status, "value", status),
            tags=getattr(scenario, "tags", None),
            meta=getattr(scenario, "meta", None),
        )


class SDKMetricsRefresher:
    """Engine `refresh_metrics` adapter — SDK peer of `APIMetricsRefresher`.

    The engine calls this `(run_id, scenario_id)` per scenario (variational) and
    `(run_id, None)` once at the end (global). Wraps the injected `arefresh`
    client; the SDK has no temporal axis, so unlike the API adapter it does not
    handle timestamp/interval buckets.
    """

    def __init__(self, *, refresh: Any) -> None:
        self._refresh = refresh

    async def __call__(self, run_id: Any, scenario_id: Any = None) -> Any:
        return await self._refresh(run_id, scenario_id)


class SDKTraceFetcher:
    """Engine `fetch_trace` adapter — SDK peer of `APITraceFetcher`.

    A callable `(trace_id) -> trace | None`, wrapping the injected `afetch_trace`
    client so the engine loads a runner's trace after a step executes.
    """

    def __init__(self, *, fetch: Any) -> None:
        self._fetch = fetch

    async def __call__(self, trace_id: str) -> Any:
        return await self._fetch(trace_id)


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
