"""Sessions domain service: message/turn input validation above the DAO seam."""

import json

from .dtos import Message, MessageRole, Session, SessionStatus, Turn, TurnStatus
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
        self, *, session_id: str, client_turn_id: str, input_hash: str
    ) -> Turn:
        if not client_turn_id.strip():
            raise ValueError("client_turn_id must be non-empty")
        return await self._sessions.begin_turn(
            session_id=session_id,
            client_turn_id=client_turn_id,
            input_hash=input_hash,
        )

    async def finish_turn(
        self,
        *,
        turn_id: str,
        status: TurnStatus | str,
        error_json: str | None = None,
    ) -> Turn:
        target = TurnStatus(status)
        if error_json is not None:
            _require_json_object(error_json, "error_json")
        return await self._sessions.finish_turn(
            turn_id=turn_id, status=target, error_json=error_json
        )

    async def append_message(
        self,
        *,
        session_id: str,
        turn_id: str,
        role: MessageRole | str,
        content_json: str,
    ) -> Message:
        # Messages attach only while their turn is pending/running (contracts.md:
        # completed turns close atomically with their assistant message; later
        # appends are rejected). Enforced inside the DAO transaction.
        checked_role = MessageRole(role)
        _require_json_object(content_json, "content_json")
        return await self._sessions.append_message(
            session_id=session_id,
            turn_id=turn_id,
            role=checked_role,
            content_json=content_json,
        )

    async def list_messages(self, *, session_id: str) -> list[Message]:
        return await self._sessions.list_messages(session_id=session_id)

    async def interrupt_incomplete_turns(self) -> int:
        return await self._sessions.interrupt_incomplete_turns()
