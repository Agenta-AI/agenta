from asyncio import Semaphore, gather
from typing import Any, Callable, Dict, List, Optional
from uuid import UUID

from agenta.sdk.evaluations.runtime.models import (
    ResultLogRequest,
    WorkflowExecutionRequest,
    WorkflowExecutionResult,
)
from agenta.sdk.models.evaluations import EvaluationStatus as SdkEvaluationStatus

from oss.src.core.evaluations.runtime.cache import RunnableCacheResolver
from oss.src.core.evaluations.types import (
    EvaluationClosedConflict,
    EvaluationMetricsRefresh,
    EvaluationMetricsInvalid,
    EvaluationResultCreate,
    EvaluationScenarioCreate,
    EvaluationScenarioEdit,
    EvaluationStatus,
)
from oss.src.core.evaluations.utils import fetch_trace
from oss.src.core.workflows.dtos import (
    WorkflowServiceRequest,
    WorkflowServiceRequestData,
)


def _status(status: Any) -> EvaluationStatus:
    value = getattr(status, "value", status)
    return EvaluationStatus(value)


def _read_field(source: Any, field: str) -> Any:
    if isinstance(source, dict):
        return source.get(field)
    return getattr(source, field, None)


def _project_inputs(inputs: Any, data: Any) -> Any:
    """Project source inputs onto the revision's declared input schema.

    A source row (e.g. a testcase) carries every column — input columns plus
    ground-truth/bookkeeping keys like ``correct_answer`` or ``testcase_id``.
    The invoked workflow should only receive the inputs its revision declares,
    so filter ``inputs`` down to the keys present in
    ``data.schemas.inputs.properties``.

    If the revision declares no input schema (no ``properties``), inputs pass
    through unchanged so untyped/legacy revisions are not broken.
    """
    if not isinstance(inputs, dict):
        return inputs

    schemas = _read_field(data, "schemas") if data is not None else None
    inputs_schema = _read_field(schemas, "inputs") if schemas is not None else None
    properties = (
        _read_field(inputs_schema, "properties") if inputs_schema is not None else None
    )
    if not isinstance(properties, dict) or not properties:
        return inputs

    return {key: value for key, value in inputs.items() if key in properties}


def _dump_model(source: Any, **kwargs: Any) -> Any:
    if hasattr(source, "model_dump"):
        return source.model_dump(**kwargs)
    return source


def _dump_json(source: Any) -> Any:
    if hasattr(source, "model_dump"):
        return source.model_dump(mode="json", exclude_none=True)
    if isinstance(source, dict):
        return {key: _dump_json(value) for key, value in source.items()}
    if isinstance(source, list):
        return [_dump_json(value) for value in source]
    return source


class APIWorkflowServiceRunner:
    """API adapter from SDK runtime requests to the backend workflow service."""

    def __init__(
        self,
        *,
        workflows_service: Any,
        request_builder: Optional[
            Callable[[WorkflowExecutionRequest], Dict[str, Any]]
        ] = None,
    ):
        self.workflows_service = workflows_service
        self.request_builder = request_builder

    async def execute(
        self,
        request: WorkflowExecutionRequest,
    ) -> WorkflowExecutionResult:
        kwargs = (
            self.request_builder(request)
            if self.request_builder
            else request.model_dump(mode="python", exclude_none=True)
        )
        response = await self.workflows_service.invoke_workflow(**kwargs)
        status = getattr(response, "status", None)
        status_code = getattr(status, "code", None)
        has_error = status_code != 200
        error = None

        if has_error:
            error = (
                status.model_dump(mode="json", exclude_none=True)
                if hasattr(status, "model_dump")
                else {"code": status_code}
            )

        return WorkflowExecutionResult(
            status=(
                SdkEvaluationStatus.FAILURE
                if has_error
                else SdkEvaluationStatus.SUCCESS
            ),
            trace_id=getattr(response, "trace_id", None),
            span_id=getattr(response, "span_id", None),
            error=error,
            outputs=getattr(response, "outputs", None),
        )


class APIScenarioFactory:
    def __init__(
        self,
        *,
        project_id: UUID,
        user_id: UUID,
        evaluations_service: Any,
    ):
        self.project_id = project_id
        self.user_id = user_id
        self.evaluations_service = evaluations_service

    async def bulk_create(
        self,
        run_id: UUID,
        *,
        count: int,
        timestamp: Any = None,
        interval: Optional[int] = None,
    ) -> List[Any]:
        """Mint `count` RUNNING scenarios for a run in one DAO call.

        The bulk counterpart of the retired streaming factory: the unified
        ingest flows (run/slice) mint all scenarios up front, then populate and
        re-execute them. `timestamp`/`interval` are the run-wide temporal
        coordinates (live query); they stay None for non-live runs. Order is
        preserved by `create_scenarios`, so the returned list aligns 1:1 with
        the source items the caller intends to bind.
        """
        if count <= 0:
            return []
        scenarios = await self.evaluations_service.create_scenarios(
            project_id=self.project_id,
            user_id=self.user_id,
            scenarios=[
                EvaluationScenarioCreate(
                    run_id=run_id,
                    timestamp=timestamp,
                    interval=interval,
                    status=EvaluationStatus.RUNNING,
                )
                for _ in range(count)
            ],
        )
        if len(scenarios) != count:
            raise ValueError(
                f"Failed to create {count} scenario(s) for run {run_id}: "
                f"got {len(scenarios)}."
            )
        return scenarios


class APIResultSetter:
    def __init__(
        self,
        *,
        project_id: UUID,
        user_id: UUID,
        timestamp: Any,
        interval: Optional[int],
        evaluations_service: Any,
    ):
        self.project_id = project_id
        self.user_id = user_id
        self.timestamp = timestamp
        self.interval = interval
        self.evaluations_service = evaluations_service

    async def set(self, request: ResultLogRequest) -> Any:
        cell = request.cell
        results = await self.evaluations_service.set_results(
            project_id=self.project_id,
            user_id=self.user_id,
            results=[
                EvaluationResultCreate(
                    run_id=cell.run_id,
                    scenario_id=cell.scenario_id,
                    step_key=cell.step_key,
                    repeat_idx=cell.repeat_idx,
                    status=_status(cell.status),
                    trace_id=(
                        request.trace_id
                        if request.trace_id is not None
                        else cell.trace_id
                    ),
                    testcase_id=(
                        request.testcase_id
                        if request.testcase_id is not None
                        else cell.testcase_id
                    ),
                    error=request.error if request.error is not None else cell.error,
                    timestamp=self.timestamp,
                    interval=self.interval,
                )
            ],
        )
        return results[0] if results else None


class APIScenarioEditor:
    """Engine `edit_scenario` adapter: write one scenario's terminal status.

    The engine computes each scenario's verdict in-loop, so the status write is
    a property of `process` itself (shared by ingest + re-execute) rather than a
    separate post-process. Tolerates a mid-flight run close: closing is a lock,
    not a failure, so a write that loses the race is skipped, not raised.
    """

    def __init__(
        self,
        *,
        project_id: UUID,
        user_id: UUID,
        evaluations_service: Any,
    ):
        self.project_id = project_id
        self.user_id = user_id
        self.evaluations_service = evaluations_service

    async def __call__(self, scenario: Any, status: Any) -> Any:
        try:
            return await self.evaluations_service.edit_scenario(
                project_id=self.project_id,
                user_id=self.user_id,
                scenario=EvaluationScenarioEdit(
                    id=scenario.id,
                    tags=getattr(scenario, "tags", None),
                    meta=getattr(scenario, "meta", None),
                    status=_status(status),
                ),
            )
        except EvaluationClosedConflict:
            return None


class APIMetricsRefresher:
    """Single adapter for all three metric-refresh shapes.

    A metric belongs to exactly one of three kinds, keyed by which coordinates
    are set (the same classification `set_metrics` enforces downstream):
      - variational: scenario_id(s) set, no timestamp   -> per-scenario rows
      - temporal:    timestamp(s)+interval, no scenario  -> time-bucket rows
      - global:      neither                             -> the whole-run row

    The caller chooses the shape by which arguments it passes; passing a
    scenario together with a timestamp is the both-set shape that matches no
    unique index and is rejected here before it can reach the DAO.
    """

    def __init__(
        self,
        *,
        project_id: UUID,
        user_id: UUID,
        evaluations_service: Any,
    ):
        self.project_id = project_id
        self.user_id = user_id
        self.evaluations_service = evaluations_service

    async def __call__(
        self,
        run_id: UUID,
        scenario_id: Optional[UUID] = None,
        *,
        scenario_ids: Optional[List[UUID]] = None,
        timestamps: Optional[List[Any]] = None,
        interval: Optional[int] = None,
    ) -> Any:
        # The SDK runtime calls this positionally as (run_id, scenario_id) for
        # the per-scenario variational refresh and (run_id, None) for the
        # run-level global rollup. `_refresh_slice_aggregate` calls it by keyword
        # for the temporal buckets and the global fallback.
        has_scenario = scenario_id is not None or bool(scenario_ids)
        has_temporal = bool(timestamps)
        if has_scenario and has_temporal:
            raise EvaluationMetricsInvalid(
                run_id=run_id,
                scenario_id=scenario_id,
                timestamp=timestamps[0] if timestamps else None,
            )

        return await self.evaluations_service.refresh_metrics(
            project_id=self.project_id,
            user_id=self.user_id,
            metrics=EvaluationMetricsRefresh(
                run_id=run_id,
                scenario_id=scenario_id,
                scenario_ids=scenario_ids,
                timestamps=timestamps,
                interval=interval,
            ),
        )


class APITraceLoader:
    """Callable trace loader: `await loader(trace_id) -> trace`.

    The engine's `fetch_trace` seam is a plain async callable; this named class
    carries the bound `project_id`/`tracing_service` and is invoked directly
    (its instance IS the callable), so the API keeps a readable named adapter
    while satisfying the callable contract.
    """

    def __init__(
        self,
        *,
        project_id: UUID,
        tracing_service: Any,
    ):
        self.project_id = project_id
        self.tracing_service = tracing_service

    async def __call__(self, trace_id: str) -> Any:
        return await fetch_trace(
            tracing_service=self.tracing_service,
            project_id=self.project_id,
            trace_id=trace_id,
        )


class APIWorkflowRunner:
    def __init__(
        self,
        *,
        project_id: UUID,
        user_id: UUID,
        workflows_service: Any,
    ):
        self.project_id = project_id
        self.user_id = user_id
        self.workflows_service = workflows_service

    async def execute(
        self,
        request: WorkflowExecutionRequest,
    ) -> WorkflowExecutionResult:
        return (await self.execute_batch([request]))[0]

    async def execute_batch(
        self,
        requests: List[WorkflowExecutionRequest],
        semaphore: Optional[Semaphore] = None,
    ) -> List[WorkflowExecutionResult]:
        async def _guarded(
            request: WorkflowExecutionRequest,
        ) -> WorkflowExecutionResult:
            if semaphore is not None:
                async with semaphore:
                    return await self._execute_one(request)
            return await self._execute_one(request)

        return list(await gather(*(_guarded(r) for r in requests)))

    async def _execute_one(
        self,
        request: WorkflowExecutionRequest,
    ) -> WorkflowExecutionResult:
        revision = request.revision
        data = _read_field(revision, "data")
        if isinstance(revision, dict):
            revision_dump = revision
        elif hasattr(revision, "model_dump"):
            revision_dump = revision.model_dump(mode="json", exclude_none=True)
        else:
            revision_dump = revision

        parameters = _read_field(data, "parameters") if data else None
        flags = _read_field(revision, "flags")
        flags = (
            _dump_model(
                flags,
                mode="json",
                exclude_none=True,
                exclude_unset=True,
            )
            if flags
            else None
        )
        response = await self.workflows_service.invoke_workflow(
            project_id=self.project_id,
            user_id=self.user_id,
            request=WorkflowServiceRequest(
                version="2025.07.14",
                flags=flags,
                data=WorkflowServiceRequestData(
                    revision=revision_dump,
                    parameters=parameters,
                    testcase=(
                        request.source.testcase.model_dump(
                            mode="json",
                            exclude_none=True,
                        )
                        if hasattr(request.source.testcase, "model_dump")
                        else request.source.testcase
                    ),
                    inputs=_project_inputs(request.source.inputs, data),
                    trace=(
                        request.upstream_trace.model_dump(
                            mode="json",
                            exclude_none=True,
                        )
                        if hasattr(request.upstream_trace, "model_dump")
                        else request.upstream_trace
                    ),
                    outputs=request.upstream_outputs or request.source.outputs,
                ),
                references=_dump_json(request.references),
                links=request.links or {},
            ),
        )
        status = getattr(response, "status", None)
        status_code = getattr(status, "code", None)
        has_error = status_code != 200
        return WorkflowExecutionResult(
            status=(
                SdkEvaluationStatus.FAILURE
                if has_error
                else SdkEvaluationStatus.SUCCESS
            ),
            trace_id=getattr(response, "trace_id", None),
            span_id=getattr(response, "span_id", None),
            error=(
                status.model_dump(mode="json", exclude_none=True)
                if has_error and hasattr(status, "model_dump")
                else {"code": status_code}
                if has_error
                else None
            ),
            outputs=getattr(response, "outputs", None),
        )


class APIEvaluatorRunner(APIWorkflowRunner):
    def __init__(
        self,
        *,
        project_id: UUID,
        user_id: UUID,
        workflows_service: Any,
    ):
        super().__init__(
            project_id=project_id,
            user_id=user_id,
            workflows_service=workflows_service,
        )


class APICachedRunner:
    def __init__(
        self,
        *,
        runner: Any,
        tracing_service: Any,
        project_id: UUID,
        enabled: bool,
    ):
        self.runner = runner
        self.tracing_service = tracing_service
        self.project_id = project_id
        self.enabled = enabled
        self.cache_resolver = RunnableCacheResolver()

    async def execute(
        self,
        request: WorkflowExecutionRequest,
    ) -> WorkflowExecutionResult:
        return (await self.execute_batch([request]))[0]

    async def execute_batch(
        self,
        requests: List[WorkflowExecutionRequest],
        semaphore: Optional[Semaphore] = None,
    ) -> List[WorkflowExecutionResult]:
        results: List[Optional[WorkflowExecutionResult]] = [None] * len(requests)
        missing: List[WorkflowExecutionRequest] = []
        missing_positions: List[int] = []

        for idx, request in enumerate(requests):
            cache = await self.cache_resolver.resolve(
                tracing_service=self.tracing_service,
                project_id=self.project_id,
                enabled=self.enabled and self.tracing_service is not None,
                references=request.references,
                links=request.links,
                required_count=1,
            )
            reusable = cache.reusable_traces[0] if cache.reusable_traces else None
            if reusable and getattr(reusable, "trace_id", None):
                results[idx] = WorkflowExecutionResult(
                    status=SdkEvaluationStatus.SUCCESS,
                    trace_id=str(reusable.trace_id),
                    trace=reusable,
                )
                continue

            missing.append(request)
            missing_positions.append(idx)

        if missing:
            executed = await self.runner.execute_batch(missing, semaphore=semaphore)
            for idx, execution in zip(missing_positions, executed):
                results[idx] = execution

        return [result for result in results if result is not None]
