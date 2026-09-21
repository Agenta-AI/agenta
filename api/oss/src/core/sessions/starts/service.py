import asyncio
from contextlib import asynccontextmanager
from time import monotonic
from typing import Any, AsyncIterator, Awaitable, Callable
from uuid import UUID, uuid4

from agenta.sdk.agents import Message
from agenta.sdk.decorators.running import WorkflowServiceRequest
from agenta.sdk.models.workflows import WorkflowRequestData

from oss.src.core.sessions.executions.interfaces import SessionExecutionsDAOInterface
from oss.src.core.sessions.inputs.service import SessionInputsService
from oss.src.core.sessions.starts.dtos import SessionStartResult
from oss.src.core.sessions.starts.types import SessionStartNotDurable
from oss.src.core.sessions.streams.interfaces import SessionStreamsDAOInterface
from oss.src.core.shared.idempotency import resource_identity
from oss.src.core.workflows.service import WorkflowsService
from oss.src.core.workflows.types import invoke_never_dispatched
from oss.src.utils.logging import get_module_logger


log = get_module_logger(__name__)


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
        streams_dao: SessionStreamsDAOInterface | None = None,
        poll_timeout_seconds: float = 2.0,
        sleep: Callable[[float], Awaitable[None]] = asyncio.sleep,
    ) -> None:
        self._inputs = inputs_service
        self._executions = executions_dao
        self._streams = streams_dao
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
            for _ in range(100):
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

    async def _has_started(
        self,
        *,
        project_id: UUID,
        session_id: str,
        execution_id: str,
    ) -> bool:
        execution = await self._executions.fetch_execution(
            project_id=project_id,
            session_id=session_id,
            execution_id=execution_id,
        )
        if execution is not None:
            return True
        # Initial runs have a stream heartbeat before they have a settlement row.
        if self._streams is not None:
            stream = await self._streams.get_by_session_id(
                project_id=project_id,
                session_id=session_id,
            )
            return stream is not None and stream.turn_id == execution_id
        return False

    async def _wait_for_start(
        self,
        *,
        project_id: UUID,
        session_id: str,
        execution_id: str,
    ) -> bool:
        deadline = monotonic() + self._poll_timeout_seconds
        delay = 0.05
        while True:
            execution = await self._has_started(
                project_id=project_id,
                session_id=session_id,
                execution_id=execution_id,
            )
            if execution:
                return True
            remaining = deadline - monotonic()
            if remaining <= 0:
                return False
            await self._sleep(min(delay, remaining))
            delay = min(delay * 2, 0.25)

    @staticmethod
    def _request(
        *,
        session_id: str,
        workflow_id: UUID,
        revision_id: UUID,
        message: str | Message,
        parameters: dict[str, Any] | None = None,
    ) -> WorkflowServiceRequest:
        return WorkflowServiceRequest(
            session_id=session_id,
            references={
                "workflow": {"id": workflow_id},
                "workflow_revision": {"id": revision_id},
            },
            data=WorkflowRequestData(
                inputs={
                    "messages": [
                        message.to_wire()
                        if isinstance(message, Message)
                        else {"role": "user", "content": message}
                    ]
                },
                parameters=parameters,
            ),
        )

    async def _release_dispatch(
        self,
        *,
        project_id: UUID,
        session_id: str,
        input_id: UUID,
        execution_id: str,
    ) -> None:
        """Hand the one-shot dispatch claim back so one later retry can invoke again.

        Only for an invoke that provably never reached the service. Without this the claim is
        permanent, and every retry carrying the same request key raises `SessionStartNotDurable`
        forever: the agent exists and its first turn can never start. A failed release keeps that
        old behaviour rather than risking a second dispatch, so it is logged and swallowed.
        """
        try:
            await self._inputs.release_dispatch(
                project_id=project_id,
                session_id=session_id,
                input_id=input_id,
                execution_id=execution_id,
            )
        except Exception as exc:  # noqa: BLE001
            log.warning(
                "[SESSIONS] dispatch claim release failed for "
                f"session={session_id} execution={execution_id}: {exc}"
            )

    @staticmethod
    def session_id_for(*, project_id: UUID, request_key: str) -> str:
        return str(
            resource_identity(project_id, _START_NAMESPACE, request_key, "session")
        )

    async def start_once(
        self,
        *,
        project_id: UUID,
        user_id: UUID,
        workflow_id: UUID,
        revision_id: UUID,
        message: str | Message,
        parameters: dict[str, Any] | None = None,
        request_key: str,
    ) -> SessionStartResult:
        session_id = self.session_id_for(project_id=project_id, request_key=request_key)
        execution_id = str(
            resource_identity(project_id, _START_NAMESPACE, request_key, "execution")
        )
        request = self._request(
            session_id=session_id,
            workflow_id=workflow_id,
            revision_id=revision_id,
            message=message,
            parameters=parameters,
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
            existing = await self._has_started(
                project_id=project_id,
                session_id=session_id,
                execution_id=execution_id,
            )
            if existing:
                return SessionStartResult(
                    session_id=session_id,
                    execution_id=execution_id,
                    input_id=claimed.id,
                    replayed=True,
                )

            dispatch = await self._inputs.claim_dispatch(
                project_id=project_id,
                session_id=session_id,
                input_id=claimed.id,
                execution_id=execution_id,
            )
            if not dispatch:
                durable = await self._wait_for_start(
                    project_id=project_id,
                    session_id=session_id,
                    execution_id=execution_id,
                )
                if not durable:
                    raise SessionStartNotDurable()
                return SessionStartResult(
                    session_id=session_id,
                    execution_id=execution_id,
                    input_id=claimed.id,
                    replayed=True,
                )

            stored_request = WorkflowServiceRequest.model_validate(claimed.content)
            error: Exception | None = None
            # `except Exception` deliberately lets `asyncio.CancelledError` through with the claim
            # still held. A shutdown or a client disconnect can cancel this task with the request
            # already on the wire, which is the ambiguous case, not a never-sent one. Nothing is
            # awaited between the claim and this call, so a cancel cannot strand the claim before
            # the invoke begins; once it has begun, only the service knows what it accepted.
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

            durable = await self._wait_for_start(
                project_id=project_id,
                session_id=session_id,
                execution_id=execution_id,
            )
            if not durable:
                if error is not None:
                    if invoke_never_dispatched(error):
                        await self._release_dispatch(
                            project_id=project_id,
                            session_id=session_id,
                            input_id=claimed.id,
                            execution_id=execution_id,
                        )
                    raise SessionStartNotDurable() from error
                raise SessionStartNotDurable()

            return SessionStartResult(
                session_id=session_id,
                execution_id=execution_id,
                input_id=claimed.id,
                replayed=False,
            )
