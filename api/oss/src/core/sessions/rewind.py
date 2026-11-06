"""Rewind: remove a turn and every later turn from a session, for every reader.

A session's history lives in three places. The record log feeds the transcript and a cold
replay. The warm sandbox holds the harness process. The turn ledger names the native harness
session a cold start resumes. A rewind has to reach all three, or the removed turns come back.
"""

from typing import Optional
from uuid import UUID

from oss.src.core.sessions.interactions.service import SessionInteractionsService
from oss.src.core.sessions.records.service import RecordsService
from oss.src.core.sessions.streams.runner_client import kill_runner_sandbox
from oss.src.core.sessions.streams.service import SessionStreamsService
from oss.src.core.sessions.turns.service import SessionTurnsService


# The runner drains its warm session first and keeps sweeping after the caller stops waiting,
# so a person at the screen waits for the drain, not for the sandbox provider.
_KILL_WAIT_SECONDS = 2.0


class SessionRewindBusy(Exception):
    def __init__(self, session_id: str):
        self.session_id = session_id
        super().__init__(f"Session '{session_id}' has a turn in progress.")


class SessionRewindService:
    def __init__(
        self,
        *,
        streams_service: SessionStreamsService,
        records_service: RecordsService,
        turns_service: SessionTurnsService,
        interactions_service: SessionInteractionsService,
    ) -> None:
        self._streams = streams_service
        self._records = records_service
        self._turns = turns_service
        self._interactions = interactions_service

    async def rewind(
        self,
        *,
        project_id: UUID,
        session_id: str,
        turn_id: str,
        user_id: Optional[UUID],
    ) -> int:
        """Returns the records removed. A turn the log no longer holds changes nothing.

        The records go last: a failure before that leaves the rewind safe to retry, and a
        session with no native state only replays cold from the log."""
        if await self._streams.is_running(
            project_id=project_id, session_id=session_id
        ) or await self._records.has_active_continuation(
            project_id=project_id, session_id=session_id
        ):
            raise SessionRewindBusy(session_id)
        if not await self._records.has_turn(
            project_id=project_id, session_id=session_id, turn_id=turn_id
        ):
            return 0

        await self._interactions.cancel_session_pending(
            project_id=project_id,
            session_id=session_id,
        )
        await self._turns.forget_native_sessions(
            project_id=project_id,
            session_id=session_id,
        )
        await kill_runner_sandbox(
            project_id=str(project_id),
            session_id=session_id,
            timeout_seconds=_KILL_WAIT_SECONDS,
        )
        return await self._records.rewind_from_turn(
            project_id=project_id,
            session_id=session_id,
            turn_id=turn_id,
            user_id=user_id,
        )
