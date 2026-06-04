from asyncio import Semaphore, gather
from typing import Any, Callable, Dict, List, Optional
from uuid import UUID

from agenta.sdk.evaluations.runtime.models import (
    WorkflowExecutionRequest,
    WorkflowExecutionResult,
)
from agenta.sdk.models.evaluations import EvaluationStatus as SDKEvaluationStatus

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
from oss.src.core.evaluations.utils import TraceFetcher
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
                SDKEvaluationStatus.FAILURE
                if has_error
                else SDKEvaluationStatus.SUCCESS
            ),
            error=error,
            #
            outputs=getattr(response, "outputs", None),
            #
            trace_id=getattr(response, "trace_id", None),
            span_id=getattr(response, "span_id", None),
        )


class APIScenarioCreator:
    """Stateless: only the service is held; the request context
    (project_id/user_id/timestamp/interval) is passed per call."""

    def __init__(
        self,
        *,
        evaluations_service: Any,
    ):
        self.evaluations_service = evaluations_service

    async def create(
        self,
        *,
        project_id: UUID,
        user_id: UUID,
        #
        run_id: UUID,
        #
        count: int,
        #
        timestamp: Any = None,
        interval: Optional[int] = None,
    ) -> List[Any]:
        """Mint `count` RUNNING scenarios for a run in one DAO call.

        The unified ingest flows (run/slice) mint all scenarios up front, then
        populate and re-execute them. `timestamp`/`interval` are the run-wide
        temporal coordinates (live query); they stay None for non-live runs.
        Order is preserved by `create_scenarios`, so the returned list aligns
        1:1 with the source items the caller intends to bind.
        """
        if count <= 0:
            return []
        scenarios = await self.evaluations_service.create_scenarios(
            project_id=project_id,
            user_id=user_id,
            #
            scenarios=[
                EvaluationScenarioCreate(
                    run_id=run_id,
                    #
                    timestamp=timestamp,
                    interval=interval,
                    #
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
    """Stateless: only the service is held. The request context
    (project_id/user_id/timestamp/interval) is passed per `set` call — bound at
    the slice boundary where it is known, not at construction."""

    def __init__(
        self,
        *,
        evaluations_service: Any,
    ):
        self.evaluations_service = evaluations_service

    async def set(
        self,
        *,
        project_id: UUID,
        user_id: UUID,
        #
        cell,
        trace_id=None,
        hash_id=None,
        span_id=None,
        testcase_id=None,
        error=None,
        #
        timestamp: Any = None,
        interval: Optional[int] = None,
    ) -> Any:
        results = await self.evaluations_service.set_results(
            project_id=project_id,
            user_id=user_id,
            #
            results=[
                EvaluationResultCreate(
                    run_id=cell.run_id,
                    #
                    scenario_id=cell.scenario_id,
                    step_key=cell.step_key,
                    repeat_idx=cell.repeat_idx,
                    #
                    status=_status(cell.status),
                    trace_id=(trace_id if trace_id is not None else cell.trace_id),
                    hash_id=(
                        hash_id
                        if hash_id is not None
                        else getattr(cell, "hash_id", None)
                    ),
                    testcase_id=(
                        testcase_id if testcase_id is not None else cell.testcase_id
                    ),
                    error=error if error is not None else cell.error,
                    #
                    timestamp=timestamp,
                    interval=interval,
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
        evaluations_service: Any,
    ):
        self.evaluations_service = evaluations_service

    async def __call__(
        self,
        *,
        project_id: UUID,
        user_id: UUID,
        #
        scenario: Any,
        status: Any,
    ) -> Any:
        try:
            # The edit is a full PUT: carry EVERY persisted scenario field, not
            # just status, or the omitted ones are wiped on write (dropped flags
            # leave the scenario grey; dropped interval/timestamp break temporal
            # metrics). Only `status` is the value being changed here.
            return await self.evaluations_service.edit_scenario(
                project_id=project_id,
                user_id=user_id,
                #
                scenario=EvaluationScenarioEdit(
                    id=scenario.id,
                    #
                    flags=getattr(scenario, "flags", None),
                    tags=getattr(scenario, "tags", None),
                    meta=getattr(scenario, "meta", None),
                    #
                    interval=getattr(scenario, "interval", None),
                    timestamp=getattr(scenario, "timestamp", None),
                    #
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
        evaluations_service: Any,
    ):
        self.evaluations_service = evaluations_service

    async def __call__(
        self,
        *,
        project_id: UUID,
        user_id: UUID,
        #
        run_id: UUID,
        #
        scenario_id: Optional[UUID] = None,
        scenario_ids: Optional[List[UUID]] = None,
        timestamps: Optional[List[Any]] = None,
        interval: Optional[int] = None,
    ) -> Any:
        # The SDK runtime calls this by keyword as (run_id=, scenario_id=) for
        # the per-scenario variational refresh and (run_id=, scenario_id=None) for
        # the run-level global rollup. `_refresh_slice_aggregate` calls it by
        # keyword for the temporal buckets and the global fallback.
        has_scenario = scenario_id is not None or bool(scenario_ids)
        has_temporal = bool(timestamps)
        if has_scenario and has_temporal:
            raise EvaluationMetricsInvalid(
                run_id=run_id,
                scenario_id=scenario_id,
                timestamp=timestamps[0] if timestamps else None,
            )

        return await self.evaluations_service.refresh_metrics(
            project_id=project_id,
            user_id=user_id,
            #
            metrics=EvaluationMetricsRefresh(
                run_id=run_id,
                #
                scenario_id=scenario_id,
                scenario_ids=scenario_ids,
                timestamps=timestamps,
                interval=interval,
            ),
        )


class APITraceFetcher:
    """Callable trace loader: `await loader(trace_id) -> trace`.

    The engine's `fetch_trace` seam is a plain async callable; this named class
    carries the bound `project_id`/`tracing_service` and is invoked directly
    (its instance IS the callable), so the API keeps a readable named adapter
    while satisfying the callable contract.
    """

    def __init__(
        self,
        *,
        tracing_service: Any,
    ):
        self.tracing_service = tracing_service
        self._traces = TraceFetcher(tracing_service=tracing_service)

    async def __call__(self, *, trace_id: str, project_id: UUID) -> Any:
        return await self._traces.fetch_trace(
            project_id=project_id,
            #
            trace_id=trace_id,
        )


class APIWorkflowRunner:
    """Stateless: only the service is held. The request identity
    (project_id/user_id) the workflow is invoked AS is passed per execution and
    bound at the wiring boundary, not at construction."""

    def __init__(
        self,
        *,
        workflows_service: Any,
    ):
        self.workflows_service = workflows_service

    async def execute(
        self,
        *,
        project_id: UUID,
        user_id: UUID,
        #
        request: WorkflowExecutionRequest,
    ) -> WorkflowExecutionResult:
        return (
            await self.execute_batch(
                project_id=project_id,
                user_id=user_id,
                #
                requests=[request],
            )
        )[0]

    async def execute_batch(
        self,
        *,
        project_id: UUID,
        user_id: UUID,
        #
        requests: List[WorkflowExecutionRequest],
        #
        semaphore: Optional[Semaphore] = None,
    ) -> List[WorkflowExecutionResult]:
        async def _guarded(
            request: WorkflowExecutionRequest,
        ) -> WorkflowExecutionResult:
            if semaphore is not None:
                async with semaphore:
                    return await self._execute_one(
                        project_id=project_id,
                        user_id=user_id,
                        #
                        request=request,
                    )
            return await self._execute_one(
                project_id=project_id,
                user_id=user_id,
                #
                request=request,
            )

        return list(await gather(*(_guarded(r) for r in requests)))

    async def _execute_one(
        self,
        *,
        project_id: UUID,
        user_id: UUID,
        #
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

        testcase = request.source.testcase
        if hasattr(testcase, "model_dump"):
            testcase = testcase.model_dump(
                mode="json",
                exclude_none=True,
            )

        trace = request.upstream_trace
        if hasattr(trace, "model_dump"):
            trace = trace.model_dump(
                mode="json",
                exclude_none=True,
            )

        request_data = WorkflowServiceRequestData(
            revision=revision_dump,
            parameters=parameters,
            testcase=testcase,
            inputs=_project_inputs(request.source.inputs, data),
            trace=trace,
            outputs=request.upstream_outputs or request.source.outputs,
        )
        service_request = WorkflowServiceRequest(
            flags=flags,
            data=request_data,
            references=_dump_json(request.references),
            links=request.links or {},
        )

        response = await self.workflows_service.invoke_workflow(
            project_id=project_id,
            user_id=user_id,
            #
            request=service_request,
        )

        status = getattr(response, "status", None)
        status_code = getattr(status, "code", None)
        has_error = status_code != 200

        error = None
        if has_error:
            error = (
                status.model_dump(
                    mode="json",
                    exclude_none=True,
                )
                if hasattr(status, "model_dump")
                else {"code": status_code}
            )

        return WorkflowExecutionResult(
            status=(
                SDKEvaluationStatus.FAILURE
                if has_error
                else SDKEvaluationStatus.SUCCESS
            ),
            trace_id=getattr(response, "trace_id", None),
            span_id=getattr(response, "span_id", None),
            error=error,
            outputs=getattr(response, "outputs", None),
        )


class APICachedRunner:
    """Stateless: holds only its deps (the wrapped runner, tracing_service, the
    cache toggle). The request identity (project_id/user_id) is passed per
    execution — it scopes the trace-cache lookup and the wrapped invocation."""

    def __init__(
        self,
        *,
        tracing_service: Any,
        #
        runner: Any,
        #
        enabled: bool,
    ):
        self.tracing_service = tracing_service

        self.runner = runner
        self.enabled = enabled

        self.cache_resolver = RunnableCacheResolver(
            tracing_service=tracing_service,
        )

    async def execute(
        self,
        *,
        project_id: UUID,
        user_id: UUID,
        #
        request: WorkflowExecutionRequest,
    ) -> WorkflowExecutionResult:
        return (
            await self.execute_batch(
                project_id=project_id,
                user_id=user_id,
                #
                requests=[request],
            )
        )[0]

    async def execute_batch(
        self,
        *,
        project_id: UUID,
        user_id: UUID,
        #
        requests: List[WorkflowExecutionRequest],
        #
        semaphore: Optional[Semaphore] = None,
    ) -> List[WorkflowExecutionResult]:
        results: List[Optional[WorkflowExecutionResult]] = [None] * len(requests)
        missing: List[WorkflowExecutionRequest] = []
        missing_positions: List[int] = []
        # The cache hash per missing request, so the executed result can record
        # the hash it is (re)usable under — without it the result row stores no
        # hash_id and the next run cannot reuse this trace by hash.
        missing_hash_ids: List[Optional[str]] = []

        for idx, request in enumerate(requests):
            cache = await self.cache_resolver.resolve(
                project_id=project_id,
                #
                enabled=self.enabled and self.tracing_service is not None,
                #
                references=request.references,
                links=request.links,
                #
                required_count=1,
            )
            reusable = cache.reusable_traces[0] if cache.reusable_traces else None
            if reusable and getattr(reusable, "trace_id", None):
                results[idx] = WorkflowExecutionResult(
                    status=SDKEvaluationStatus.SUCCESS,
                    trace_id=str(reusable.trace_id),
                    hash_id=cache.hash_id,
                    trace=reusable,
                )
                continue

            missing.append(request)
            missing_positions.append(idx)
            missing_hash_ids.append(cache.hash_id)

        if missing:
            executed = await self.runner.execute_batch(
                project_id=project_id,
                user_id=user_id,
                #
                requests=missing,
                #
                semaphore=semaphore,
            )
            for idx, execution, hash_id in zip(
                missing_positions, executed, missing_hash_ids
            ):
                # Tag the freshly-executed result with its cache hash so the
                # result row records what it is cacheable under (the inner runner
                # does not compute hashes; the cache layer owns them).
                if execution.hash_id is None:
                    execution.hash_id = hash_id
                results[idx] = execution

        return [result for result in results if result is not None]
