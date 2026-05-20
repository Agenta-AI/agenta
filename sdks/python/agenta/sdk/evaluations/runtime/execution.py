from asyncio import Semaphore, gather
from datetime import datetime
from inspect import signature
from typing import Any, Awaitable, Callable, Dict, List, Optional, Protocol
from uuid import UUID

from agenta.sdk.evaluations.runtime.models import (
    PlannedCell,
    ResultLogRequest,
    WorkflowExecutionRequest,
    WorkflowExecutionResult,
)


class WorkflowRunner(Protocol):
    """Adapter boundary for application/evaluator execution.

    SDK-local evaluation, API service execution, and backend-internal workflow
    invocation should each implement this protocol instead of changing the
    planner or topology classifier.
    """

    async def execute(
        self,
        request: WorkflowExecutionRequest,
    ) -> WorkflowExecutionResult: ...


class WorkflowBatchRunner(WorkflowRunner, Protocol):
    """Optional batch execution boundary for any runnable workflow step."""

    async def execute_batch(
        self,
        requests: List[WorkflowExecutionRequest],
    ) -> List[WorkflowExecutionResult]: ...


async def execute_workflow_batch(
    *,
    runner: WorkflowRunner,
    requests: List[WorkflowExecutionRequest],
    semaphore: Optional[Semaphore] = None,
) -> List[WorkflowExecutionResult]:
    execute_batch = getattr(runner, "execute_batch", None)

    async def _guarded(request: WorkflowExecutionRequest) -> WorkflowExecutionResult:
        if semaphore is not None:
            async with semaphore:
                return await runner.execute(request)
        return await runner.execute(request)

    if execute_batch is not None:
        try:
            params = signature(execute_batch).parameters
            accepts_semaphore = "semaphore" in params or any(
                p.kind == p.VAR_KEYWORD for p in params.values()
            )
        except (ValueError, TypeError):
            accepts_semaphore = False
        if accepts_semaphore:
            return await execute_batch(requests, semaphore=semaphore)
        return await execute_batch(requests)

    return list(await gather(*(_guarded(request) for request in requests)))


class EvaluationTaskRunner(Protocol):
    """Generic evaluation task dispatch boundary.

    SDK/local code should use an in-process asyncio implementation. API code can
    adapt this protocol to Taskiq without Taskiq leaking into SDK runtime code.
    """

    async def process_run(
        self,
        *,
        project_id: UUID,
        user_id: UUID,
        run_id: UUID,
        newest: Optional[datetime] = None,
        oldest: Optional[datetime] = None,
    ) -> Any: ...

    async def process_slice(
        self,
        *,
        project_id: UUID,
        user_id: UUID,
        run_id: UUID,
        source_kind: str,
        trace_ids: Optional[List[str]] = None,
        testcase_ids: Optional[List[UUID]] = None,
        input_step_key: Optional[str] = None,
    ) -> Any: ...


class AsyncioEvaluationTaskRunner:
    """In-process task runner adapter for SDK/local evaluation execution."""

    def __init__(
        self,
        *,
        process_run: Optional[Callable[..., Awaitable[Any]]] = None,
        process_slice: Optional[Callable[..., Awaitable[Any]]] = None,
    ):
        self._process_run = process_run
        self._process_slice = process_slice

    async def process_run(self, **kwargs: Any) -> Any:
        if self._process_run is None:
            raise RuntimeError("process_run handler is not configured")
        return await self._process_run(**kwargs)

    async def process_slice(self, **kwargs: Any) -> Any:
        if self._process_slice is None:
            raise RuntimeError("process_slice handler is not configured")
        return await self._process_slice(**kwargs)


class ResultLogger(Protocol):
    """Adapter boundary for persisting planned result cells."""

    async def log(self, request: ResultLogRequest) -> Any: ...


class TraceLoader(Protocol):
    """Adapter boundary for loading runner traces after a step executes."""

    async def load(self, trace_id: str) -> Optional[Any]: ...


class RuntimeExecutionContext:
    """Small mutable context shared by runner adapters while processing a scenario."""

    def __init__(self) -> None:
        self.results: Dict[str, Any] = {}
        self.traces: Dict[str, Any] = {}
        self.outputs: Dict[str, Any] = {}

    def remember_result(self, *, cell: PlannedCell, result: Any) -> None:
        self.results[cell.step_key] = result

    def remember_execution(
        self,
        *,
        cell: PlannedCell,
        execution: WorkflowExecutionResult,
    ) -> None:
        if execution.trace is not None:
            self.traces[cell.step_key] = execution.trace
        if execution.outputs is not None:
            self.outputs[cell.step_key] = execution.outputs
