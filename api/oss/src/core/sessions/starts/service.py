import asyncio
from contextlib import asynccontextmanager
from time import monotonic
from typing import Any, AsyncIterator, Awaitable, Callable
from uuid import UUID, uuid4

from agenta.sdk.decorators.running import WorkflowServiceRequest
from agenta.sdk.models.workflows import WorkflowRequestData

from oss.src.core.sessions.executions.dtos import SessionExecutionSettlement
from oss.src.core.sessions.executions.interfaces import SessionExecutionsDAOInterface
from oss.src.core.sessions.inputs.service import SessionInputsService
from oss.src.core.sessions.starts.dtos import SessionStartResult
from oss.src.core.sessions.starts.types import SessionStartNotDurable
from oss.src.core.shared.idempotency import resource_identity
from oss.src.core.workflows.service import WorkflowsService


_RELEASE_START_LOCK = """
if redis.call('get', KEYS[1]) == ARGV[1] then
  return redis.call('del', KEYS[1])
else
  return 0
end
"""
_START_NAMESPACE = "session-start"


class SessionStartsService:
    def __init__(
        self,
        *,
        inputs_service: SessionInputsService,
        executions_dao: SessionExecutionsDAOInterface,
        workflows_service: WorkflowsService,
        lock_engine: Any,
        poll_timeout_seconds: float = 2.0,
        sleep: Callable[[float], Awaitable[None]] = asyncio.sleep,
    ) -> None:
        self._inputs = inputs_service
        self._executions = executions_dao
        self._workflows = workflows_service
        self._lock_engine = lock_engine
        self._poll_timeout_seconds = poll_timeout_seconds
        self._sleep = sleep

    @asynccontextmanager
    async def _start_lock(
        self,
        *,
        project_id: UUID,
        execution_id: str,
    ) -> AsyncIterator[None]:
        key = f"agenta:session-start:{project_id}:{execution_id}"
        token = uuid4().hex
        acquired = False
        try:
            for _ in range(600):
                acquired = bool(await self._lock_engine.set(key, token, nx=True, ex=60))
                if acquired:
                    break
                await self._sleep(0.05)
        except Exception as exc:
            raise SessionStartNotDurable() from exc
        if not acquired:
            raise SessionStartNotDurable()

        try:
            yield
        finally:
            try:
                await self._lock_engine.eval(
                    _RELEASE_START_LOCK,
                    1,
                    key,
                    token,
                )
            except Exception:
                # The lock has a TTL. A release failure cannot make a durable start
                # disappear, and the next retry will read the execution row.
                pass

    async def _fetch_execution(
        self,
        *,
        project_id: UUID,
        session_id: str,
        execution_id: str,
    ) -> SessionExecutionSettlement | None:
        return await self._executions.fetch_execution(
            project_id=project_id,
            session_id=session_id,
            execution_id=execution_id,
        )

    async def _wait_for_execution(
        self,
        *,
        project_id: UUID,
        session_id: str,
        execution_id: str,
    ) -> SessionExecutionSettlement | None:
        deadline = monotonic() + self._poll_timeout_seconds
        delay = 0.05
        while True:
            execution = await self._fetch_execution(
                project_id=project_id,
                session_id=session_id,
                execution_id=execution_id,
            )
            if execution is not None:
                return execution
            remaining = deadline - monotonic()
            if remaining <= 0:
                return None
            await self._sleep(min(delay, remaining))
            delay = min(delay * 2, 0.25)

    @staticmethod
    def _request(
        *,
        session_id: str,
        workflow_id: UUID,
        revision_id: UUID,
        message: str,
    ) -> WorkflowServiceRequest:
        return WorkflowServiceRequest(
            session_id=session_id,
            references={
                "workflow": {"id": workflow_id},
                "workflow_revision": {"id": revision_id},
            },
            data=WorkflowRequestData(
                inputs={"messages": [{"role": "user", "content": message}]}
            ),
        )

    async def start_once(
        self,
        *,
        project_id: UUID,
        user_id: UUID,
        workflow_id: UUID,
        revision_id: UUID,
        message: str,
        request_key: str,
    ) -> SessionStartResult:
        session_id = str(
            resource_identity(project_id, _START_NAMESPACE, request_key, "session")
        )
        execution_id = str(
            resource_identity(project_id, _START_NAMESPACE, request_key, "execution")
        )
        request = self._request(
            session_id=session_id,
            workflow_id=workflow_id,
            revision_id=revision_id,
            message=message,
        )
        content = request.model_dump(mode="json", exclude_none=True)

        async with self._start_lock(
            project_id=project_id,
            execution_id=execution_id,
        ):
            claimed = await self._inputs.claim_for_execution(
                project_id=project_id,
                user_id=user_id,
                session_id=session_id,
                execution_id=execution_id,
                content=content,
                idempotency_key=request_key,
            )
            existing = await self._fetch_execution(
                project_id=project_id,
                session_id=session_id,
                execution_id=execution_id,
            )
            if existing is not None:
                return SessionStartResult(
                    session_id=session_id,
                    execution_id=execution_id,
                    input_id=claimed.id,
                    replayed=True,
                )

            stored_request = WorkflowServiceRequest.model_validate(claimed.content)
            error: Exception | None = None
            try:
                await self._workflows.invoke_workflow_detached(
                    project_id=project_id,
                    user_id=user_id,
                    request=stored_request,
                    run_id=execution_id,
                    strict_start=True,
                )
            except Exception as exc:
                error = exc

            durable = await self._wait_for_execution(
                project_id=project_id,
                session_id=session_id,
                execution_id=execution_id,
            )
            if durable is None:
                if error is not None:
                    raise SessionStartNotDurable() from error
                raise SessionStartNotDurable()

            return SessionStartResult(
                session_id=session_id,
                execution_id=execution_id,
                input_id=claimed.id,
                replayed=error is not None,
            )
