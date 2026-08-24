"""Sessions domain service: message/turn input validation above the DAO seam."""

import json

from .dtos import Message, Session, SessionStatus, Turn
from .interfaces import SessionsDAOInterface


def _require_json_object(raw: str, field: str) -> None:
    try:
        parsed = json.loads(raw)
    except json.JSONDecodeError as exc:
        raise ValueError(f"{field} must be valid JSON") from exc
    if not isinstance(parsed, dict):
        raise ValueError(f"{field} must encode a JSON object")  # noqa: TRY004 (input validation)


class SessionsService:
    def __init__(self, sessions: SessionsDAOInterface) -> None:
        self._sessions = sessions

    async def create_session(
        self, *, agent_revision_id: str, title: str | None = None
    ) -> Session:
        return await self._sessions.create_session(
            agent_revision_id=agent_revision_id, title=title
        )

    async def get_session(self, *, session_id: str) -> Session | None:
        return await self._sessions.get_session(session_id=session_id)

    async def list_sessions(
        self, *, status: SessionStatus = SessionStatus.ACTIVE
    ) -> list[Session]:
        return await self._sessions.list_sessions(status=status)

    async def archive_session(self, *, session_id: str) -> Session:
        return await self._sessions.archive_session(session_id=session_id)

    async def begin_turn(
        self,
        *,
        session_id: str,
        client_turn_id: str,
        input: str,
        input_hash: str,
    ) -> Turn:
        if not client_turn_id.strip():
            raise ValueError("client_turn_id must be non-empty")
        return await self._sessions.begin_turn(
            session_id=session_id,
            client_turn_id=client_turn_id,
            input=input,
            input_hash=input_hash,
        )

    async def mark_turn_running(self, *, turn_id: str) -> Turn:
        return await self._sessions.mark_turn_running(turn_id=turn_id)

    async def load_completed_context(
        self, *, session_id: str, current_turn_id: str
    ) -> list[Message]:
        return await self._sessions.load_completed_context(
            session_id=session_id, current_turn_id=current_turn_id
        )

    async def complete_turn(self, *, turn_id: str, assistant_message: str) -> Turn:
        if not assistant_message:
            raise ValueError("assistant_message must be non-empty")
        return await self._sessions.complete_turn(
            turn_id=turn_id, assistant_message=assistant_message
        )

    async def fail_turn(self, *, turn_id: str, error: str) -> Turn:
        _require_json_object(error, "error")
        return await self._sessions.fail_turn(turn_id=turn_id, error=error)

    async def cancel_turn(self, *, turn_id: str) -> Turn:
        return await self._sessions.cancel_turn(turn_id=turn_id)

    async def interrupt_turn(self, *, turn_id: str, error: str) -> Turn:
        _require_json_object(error, "error")
        return await self._sessions.interrupt_turn(turn_id=turn_id, error=error)

    async def list_messages(self, *, session_id: str) -> list[Message]:
        return await self._sessions.list_messages(session_id=session_id)

    async def interrupt_incomplete_turns(self) -> int:
        return await self._sessions.interrupt_incomplete_turns()
