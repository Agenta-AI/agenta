import hashlib
import json
from typing import Any, Awaitable, Callable, Dict, List, Optional
from uuid import UUID

from oss.src.core.sessions.inputs.dtos import (
    PendingInput,
    PendingInputAdmission,
    PendingInputCreate,
    PendingInputState,
)
from oss.src.core.sessions.inputs.interfaces import SessionInputsDAOInterface
from oss.src.core.sessions.inputs.types import (
    SessionInputBusy,
    SessionInputIdempotencyConflict,
    SessionInputNotFound,
    SessionInputNotRemovable,
)
from oss.src.core.sessions.streams.service import SessionStreamsService
from oss.src.utils.env import env


def input_fingerprint(*, content: Dict[str, Any], policy: str) -> str:
    canonical = json.dumps(
        {"content": content, "on_busy": policy},
        sort_keys=True,
        separators=(",", ":"),
        ensure_ascii=False,
    ).encode()
    return hashlib.sha256(canonical).hexdigest()


class SessionInputsService:
    def __init__(
        self,
        *,
        inputs_dao: SessionInputsDAOInterface,
        streams_service: SessionStreamsService,
        continuation_resumer: Optional[Callable[..., Awaitable[bool]]] = None,
    ) -> None:
        self._dao = inputs_dao
        self._streams = streams_service
        self._continuation_resumer = continuation_resumer

    async def admit(
        self,
        *,
        project_id: UUID,
        user_id: Optional[UUID],
        session_id: str,
        content: Dict[str, Any],
        policy: str,
        idempotency_key: Optional[str],
    ) -> PendingInputAdmission:
        fingerprint = input_fingerprint(content=content, policy=policy)
        if idempotency_key:
            existing = await self._dao.fetch_by_idempotency_key(
                project_id=project_id,
                session_id=session_id,
                idempotency_key=idempotency_key,
            )
            if existing is not None:
                if existing.request_fingerprint != fingerprint:
                    raise SessionInputIdempotencyConflict()
                return PendingInputAdmission(
                    action="pending",
                    input=existing,
                    execution_id=existing.promoted_execution_id,
                )

        stream = await self._streams.fetch_header(
            project_id=project_id, session_id=session_id
        )
        busy = bool(stream and stream.flags and stream.flags.is_running)
        if (
            not busy
            and (env.agenta.sessions.durable_approvals or env.agenta.sessions.queue)
            and self._continuation_resumer is not None
        ):
            busy = await self._continuation_resumer(
                project_id=project_id,
                session_id=session_id,
            )
        if not busy:
            return PendingInputAdmission(action="execute")

        current_execution_id = stream.turn_id if stream else None
        queue_enabled = env.agenta.sessions.queue
        steer_enabled = queue_enabled and env.agenta.sessions.steer
        if policy == "steer" and not steer_enabled:
            raise SessionInputBusy(current_execution_id=current_execution_id)
        if policy not in ("queue", "steer") or not queue_enabled:
            raise SessionInputBusy(current_execution_id=current_execution_id)
        if not idempotency_key:
            raise ValueError("Idempotency-Key is required when queueing input.")

        async with self._dao.transaction() as transaction:
            existing = await self._dao.fetch_by_idempotency_key(
                project_id=project_id,
                session_id=session_id,
                idempotency_key=idempotency_key,
                transaction=transaction,
            )
            if existing is not None:
                if existing.request_fingerprint != fingerprint:
                    raise SessionInputIdempotencyConflict()
                return PendingInputAdmission(
                    action="pending",
                    input=existing,
                    execution_id=current_execution_id,
                )
            item = await self._dao.create_input(
                user_id=user_id,
                pending_input=PendingInputCreate(
                    project_id=project_id,
                    session_id=session_id,
                    content=content,
                    policy=policy,
                    idempotency_key=idempotency_key,
                    request_fingerprint=fingerprint,
                ),
                prioritize=policy == "steer",
                transaction=transaction,
            )
            # `create_input` rechecks under the session transaction lock, so a concurrent
            # admission can return the row that won after our optimistic read above.
            if item.request_fingerprint != fingerprint:
                raise SessionInputIdempotencyConflict()
        return PendingInputAdmission(
            action="pending", input=item, execution_id=current_execution_id
        )

    async def list_pending(
        self, *, project_id: UUID, session_id: str
    ) -> List[PendingInput]:
        if not env.agenta.sessions.queue:
            return []
        return await self._dao.list_pending(
            project_id=project_id, session_id=session_id
        )

    async def remove(
        self,
        *,
        project_id: UUID,
        user_id: Optional[UUID],
        session_id: str,
        input_id: UUID,
    ) -> PendingInput:
        item = await self._dao.remove_pending(
            project_id=project_id,
            session_id=session_id,
            input_id=input_id,
            user_id=user_id,
        )
        if item is not None:
            return item
        existing = await self._dao.fetch_input(
            project_id=project_id, session_id=session_id, input_id=input_id
        )
        if existing is not None and existing.state != PendingInputState.pending:
            raise SessionInputNotRemovable(str(input_id))
        raise SessionInputNotFound(str(input_id))
