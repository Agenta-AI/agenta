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
    EvaluationMetricsRefresh,
    EvaluationResultCreate,
    EvaluationScenarioCreate,
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



class BackendWorkflowServiceRunner:
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


class BackendScenarioFactory:
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

    async def __call__(self, run_id: UUID) -> Any:
        scenarios = await self.evaluations_service.create_scenarios(
            project_id=self.project_id,
            user_id=self.user_id,
            scenarios=[
                EvaluationScenarioCreate(
                    run_id=run_id,
                    timestamp=self.timestamp,
                    interval=self.interval,
                    status=EvaluationStatus.RUNNING,
                )
            ],
        )
        if not scenarios:
            raise ValueError(f"Failed to create scenario for run {run_id}")
        return scenarios[0]


class BackendResultLogger:
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

    async def log(self, request: ResultLogRequest) -> Any:
        cell = request.cell
        results = await self.evaluations_service.create_results(
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


class BackendMetricsRefresher:
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

    async def __call__(
        self,
        run_id: UUID,
        scenario_id: Optional[UUID],
    ) -> Any:
        return await self.evaluations_service.refresh_metrics(
            project_id=self.project_id,
            user_id=self.user_id,
            metrics=EvaluationMetricsRefresh(
                run_id=run_id,
                scenario_id=scenario_id,
                timestamp=self.timestamp,
                interval=self.interval,
            ),
        )


class BackendTraceLoader:
    def __init__(
        self,
        *,
        project_id: UUID,
        tracing_service: Any,
    ):
        self.project_id = project_id
        self.tracing_service = tracing_service

    async def load(self, trace_id: str) -> Any:
        return await fetch_trace(
            tracing_service=self.tracing_service,
            project_id=self.project_id,
            trace_id=trace_id,
        )


class BackendWorkflowRunner:
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
        async def _guarded(request: WorkflowExecutionRequest) -> WorkflowExecutionResult:
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

        interface = (
            {
                "uri": _read_field(data, "uri"),
                "url": _read_field(data, "url"),
                "headers": _read_field(data, "headers"),
                "schemas": _read_field(data, "schemas"),
            }
            if data
            else {}
        )
        configuration = (
            {
                "script": _read_field(data, "script"),
                "parameters": _read_field(data, "parameters"),
            }
            if data
            else {}
        )
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
                interface=interface,
                configuration=configuration,
                data=WorkflowServiceRequestData(
                    revision=revision_dump,
                    parameters=configuration.get("parameters"),
                    testcase=(
                        request.source.testcase.model_dump(
                            mode="json",
                            exclude_none=True,
                        )
                        if hasattr(request.source.testcase, "model_dump")
                        else request.source.testcase
                    ),
                    inputs=request.source.inputs,
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


class BackendEvaluatorRunner(BackendWorkflowRunner):
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


class BackendCachedRunner:
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
