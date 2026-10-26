import asyncio
from contextlib import asynccontextmanager
from time import monotonic
from typing import Any, AsyncIterator, Awaitable, Callable, Optional
from uuid import UUID, uuid4

from agenta.sdk.agents import Message
from agenta.sdk.decorators.running import WorkflowServiceRequest
from agenta.sdk.models.workflows import WorkflowRequestData

from oss.src.core.access.dtos import RunEnvelope
from oss.src.core.access.permissions.types import Permission
from oss.src.core.access.service import get_access_service
from oss.src.core.sessions.executions.interfaces import SessionExecutionsDAOInterface
from oss.src.core.sessions.inputs.service import SessionInputsService
from oss.src.core.sessions.starts.dtos import SessionStartResult
from oss.src.core.sessions.starts.types import SessionStartNotDurable
from oss.src.core.access.dtos import PrincipalKind, RunOrigin
from oss.src.core.sharing.service import (
    cache_created_session_access,
    channel_session_policy,
    created_session_access,
)
from oss.src.core.sessions.streams.dtos import SessionStreamCreate
from oss.src.core.sessions.streams.interfaces import SessionStreamsDAOInterface
from oss.src.core.sessions.streams.types import SessionStreamAlreadyExists
from oss.src.core.access.prefetch import request_memo_scope
from oss.src.core.sharing.admission import TEMPLATE_START_BOUNDARY, RunAdmission
from oss.src.core.sharing.dtos import AccessPolicy
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
        run_admission: RunAdmission,
        streams_dao: SessionStreamsDAOInterface | None = None,
        poll_timeout_seconds: float = 2.0,
        sleep: Callable[[float], Awaitable[None]] = asyncio.sleep,
    ) -> None:
        self._inputs = inputs_service
        self._executions = executions_dao
        self._streams = streams_dao
        self._workflows = workflows_service
        self._run_admission = run_admission
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
        """Build the first turn's request. It must not carry `on_busy`.

        Setting it turns on the workflow service's session admission, which answers a lost
        admission response with a bare 503 carrying no `x-ag-` header, after the API may already
        have committed the pending-input row. `detached_start_never_sent` reads exactly that
        shape as proof the run never started, so it would release this turn's one-shot dispatch
        claim and let a retry run the turn twice. The admission is redundant here anyway: this
        path claims and promotes its own input before invoking.
        """
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

    async def _create_session_row(
        self,
        *,
        project_id: UUID,
        user_id: UUID,
        session_id: str,
        access: AccessPolicy,
        channel_binding_id: Optional[UUID] = None,
    ) -> bool:
        """Create the session row with its initial policy, unless a first touch (a
        heartbeat, a rename, another start with the same key) already created it: that
        row keeps its policy. True when this call created the row. An id a channel
        thread names is created only by its channel's run (`SessionIdTombstoned`
        otherwise)."""
        try:
            created = await self._streams.create(
                project_id=project_id,
                user_id=user_id,
                stream=SessionStreamCreate(
                    session_id=session_id,
                    access=access,
                    channel_binding_id=channel_binding_id,
                ),
            )
        except SessionStreamAlreadyExists:
            return False
        policy, in_channel, binding_id = created_session_access(
            created, requested=access, channel_binding_id=channel_binding_id
        )
        await cache_created_session_access(
            project_id=project_id,
            session_id=session_id,
            stream_id=getattr(created, "id", None),
            policy=policy,
            is_channel=in_channel,
            channel_binding_id=binding_id,
        )
        return True

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

    async def fetch_started(
        self,
        *,
        project_id: UUID,
        request_key: str,
    ) -> SessionStartResult | None:
        """Return a start that already reached the session, without claiming or dispatching.

        A caller that no longer holds the original first message can still replay a
        finished start from its request key alone.
        """
        session_id = self.session_id_for(project_id=project_id, request_key=request_key)
        execution_id = str(
            resource_identity(project_id, _START_NAMESPACE, request_key, "execution")
        )
        claimed = await self._inputs.fetch_by_idempotency_key(
            project_id=project_id,
            session_id=session_id,
            idempotency_key=request_key,
        )
        if claimed is None or claimed.promoted_execution_id != execution_id:
            return None
        if not await self._has_started(
            project_id=project_id,
            session_id=session_id,
            execution_id=execution_id,
        ):
            return None
        return SessionStartResult(
            session_id=session_id,
            execution_id=execution_id,
            input_id=claimed.id,
            replayed=True,
        )

    async def admit_replay(
        self,
        *,
        envelope: RunEnvelope,
        session_id: str,
        workflow_id: UUID,
    ) -> None:
        """Admit the replay of a completed start: the caller may run the session and
        the agent. Raises `AdmissionDenied` (a hidden item is not readable)."""
        await self._run_admission.admit(
            envelope=envelope,
            session_id=session_id,
            agent_artifact_id=workflow_id,
            boundary=TEMPLATE_START_BOUNDARY,
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
        envelope: RunEnvelope,
        access: AccessPolicy | None = None,
    ) -> SessionStartResult:
        """`access` is the first session's initial policy (the caller's requested
        visibility, through `initial_policy`). When given, the session row is created
        with it before the invoke, so the first heartbeat finds the row and never
        writes its own default. A row that already exists keeps its policy."""
        # The start runs as the request's principal; recheck before anything is
        # claimed (AccessDenied -> 403 at the route).
        await get_access_service().require(
            envelope=envelope, action=Permission.RUN_SESSIONS
        )
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
        # Before anything is claimed, so a refusal (`AdmissionDenied`, an
        # `AccessDenied`: 403 at the route) leaves no input behind. It resolves the
        # target on `request` (after `content` is taken, so the stored input keeps its
        # references only); the invoke below sends this request, so it runs the target
        # that was checked without resolving it again.
        # The session the key names is checked too: a row that exists is another
        # start's (or a chat with the same id), and a retry may not run in a session
        # this caller cannot send to.
        # A channel session is the one its installation's run creates: private to the
        # agent's owner when the agent is private. One memo for both: the policy read
        # takes the agent entry the admission read (no round trip).
        by_channel_run = (
            envelope.context.origin == RunOrigin.INSTALLATION
            and envelope.authority.principal.kind == PrincipalKind.INSTALLATION
        )
        with request_memo_scope():
            agent_artifact_id = await self._run_admission.admit_request(
                envelope=envelope,
                session_id=session_id,
                project_id=project_id,
                request=request,
                boundary=TEMPLATE_START_BOUNDARY,
            )
            if by_channel_run and access is not None:
                access = await channel_session_policy(
                    project_id=project_id, agent_artifact_id=agent_artifact_id
                )

        async with self._start_lock(
            project_id=project_id,
            execution_id=execution_id,
        ):
            # The session row comes before every claim, so a database failure here
            # leaves nothing claimed and a retry with the same key can still invoke. A
            # row that a concurrent first touch created after the admission above was
            # never checked: it is checked here, before anything is claimed.
            if access is not None and self._streams is not None:
                created = await self._create_session_row(
                    project_id=project_id,
                    user_id=user_id,
                    session_id=session_id,
                    access=access,
                    channel_binding_id=(
                        envelope.authority.principal.id if by_channel_run else None
                    ),
                )
                if not created:
                    await self._run_admission.admit(
                        envelope=envelope,
                        session_id=session_id,
                        agent_artifact_id=None,
                        boundary=TEMPLATE_START_BOUNDARY,
                    )

            claimed = await self._inputs.claim_for_execution(
                project_id=project_id,
                user_id=user_id,
                session_id=session_id,
                execution_id=execution_id,
                content=content,
                idempotency_key=request_key,
                envelope=envelope,
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

            # `claimed.content` equals `content` (same fingerprint), so `request` is the
            # stored request with its target resolved.
            error: Exception | None = None
            # `except Exception` deliberately lets `asyncio.CancelledError` through with the claim
            # still held. A shutdown or a client disconnect can cancel this task with the request
            # already on the wire, which is the ambiguous case, not a never-sent one.
            #
            # Two narrow windows do strand the claim rather than decide it: a cancel delivered at
            # the `claim_dispatch` await after its UPDATE committed, and a cancel during the
            # readback below after a provably never-sent failure. Both need an attempt id on the
            # row to close, which needs a migration, so they are named here and not papered over.
            try:
                await self._workflows.invoke_workflow_detached(
                    project_id=project_id,
                    user_id=user_id,
                    request=request,
                    envelope=envelope,
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
