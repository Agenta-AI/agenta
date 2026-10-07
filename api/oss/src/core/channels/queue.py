"""Channel messages join the session's pending-input queue while a turn runs.

A follow-up sent while the thread's turn is still running must not be refused
and lost. The playground solves the same problem with the sessions queue: the
message is admitted as a pending input and runs as the next turn when the
current one settles. This adapter gives the inbox dispatcher that same
admission, with the one decision channels need out of it.
"""

from enum import Enum
from typing import Any, Dict, Optional
from uuid import UUID

from oss.src.core.sessions.inputs.service import SessionInputsService
from oss.src.core.sessions.inputs.types import (
    SessionInputBusy,
    SessionInputIdempotencyConflict,
)


class ChannelQueueDecision(str, Enum):
    RUN_NOW = "run_now"  # the session is free: invoke the turn
    QUEUED = "queued"  # held as a pending input; runs after the current turn
    UNAVAILABLE = "unavailable"  # busy, and this deployment cannot queue


class ChannelSessionQueue:
    def __init__(self, *, inputs_service: SessionInputsService) -> None:
        self._inputs = inputs_service

    async def admit(
        self,
        *,
        project_id: UUID,
        user_id: Optional[UUID],
        session_id: str,
        request: Dict[str, Any],
        idempotency_key: str,
    ) -> ChannelQueueDecision:
        """`request` is the invoke request exactly as the turn would send it:
        the promoted input is replayed from it verbatim.

        `idempotency_key` must be stable across task redeliveries of the same
        addressing, so a retried inbox task finds its own row and never queues
        the message twice.
        """

        try:
            admission = await self._inputs.admit(
                project_id=project_id,
                user_id=user_id,
                session_id=session_id,
                content=request,
                policy="queue",
                idempotency_key=idempotency_key,
            )
        except SessionInputBusy:
            return ChannelQueueDecision.UNAVAILABLE
        except SessionInputIdempotencyConflict:
            # The key is already held by this addressing's earlier admission;
            # the content differs only because the backlog was recomposed.
            return ChannelQueueDecision.QUEUED

        if admission.action == "pending":
            return ChannelQueueDecision.QUEUED
        return ChannelQueueDecision.RUN_NOW
