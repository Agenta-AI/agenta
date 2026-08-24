"""Core seam for session/history persistence and turn records."""

from abc import ABC, abstractmethod

from .dtos import Message, MessageRole, Session, SessionStatus, Turn, TurnStatus


class SessionsDAOInterface(ABC):
    @abstractmethod
    async def create_session(
        self, *, agent_revision_id: str, title: str | None = None
    ) -> Session:
        """Insert a session permanently bound to one existing revision."""
        raise NotImplementedError

    @abstractmethod
    async def get_session(self, *, session_id: str) -> Session | None:
        raise NotImplementedError

    @abstractmethod
    async def list_sessions(
        self, *, status: SessionStatus = SessionStatus.ACTIVE
    ) -> list[Session]:
        """Session summaries ordered by updated_at DESC, id ASC."""
        raise NotImplementedError

    @abstractmethod
    async def archive_session(self, *, session_id: str) -> Session:
        raise NotImplementedError

    @abstractmethod
    async def begin_turn(
        self, *, session_id: str, client_turn_id: str, input_hash: str
    ) -> Turn:
        """Idempotency-first turn admission inside one immediate write transaction.

        Same (session_id, client_turn_id) with the same input_hash returns the
        existing row (replay); with a different input_hash raises IdempotencyConflict;
        another pending/running turn raises SessionBusy. Checked in that order.
        """
        raise NotImplementedError

    @abstractmethod
    async def finish_turn(
        self,
        *,
        turn_id: str,
        status: TurnStatus,
        error_json: str | None = None,
    ) -> Turn:
        """Apply one transition from ALLOWED_TURN_TRANSITIONS; terminal targets also
        stamp finished_at (and running stamps started_at)."""
        raise NotImplementedError

    @abstractmethod
    async def append_message(
        self,
        *,
        session_id: str,
        turn_id: str,
        role: MessageRole,
        content_json: str,
    ) -> Message:
        """Insert one message with sequence = max(sequence)+1 while its turn is
        still pending/running; allocation and insert share one transaction so a
        failure consumes no sequence number."""
        raise NotImplementedError

    @abstractmethod
    async def list_messages(self, *, session_id: str) -> list[Message]:
        """Messages ordered by sequence ASC."""
        raise NotImplementedError

    @abstractmethod
    async def interrupt_incomplete_turns(self) -> int:
        """Startup recovery: flip every leftover pending/running turn to interrupted.

        Returns the number of rows changed.
        """
        raise NotImplementedError
