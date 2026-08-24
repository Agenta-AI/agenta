"""Core seam for session/history persistence and turn records (contracts.md)."""

from abc import ABC, abstractmethod

from .dtos import Message, Session, SessionStatus, Turn


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
        self, *, session_id: str, client_turn_id: str, input: str, input_hash: str
    ) -> Turn:
        """Idempotency-first admission; inserts turn AND user message in one
        immediate write transaction.

        Checked in order: same (session_id, client_turn_id) with identical
        input_hash raises TurnAlreadyExists carrying the existing turn id/status;
        different input_hash raises IdempotencyConflict; another pending/running
        turn raises SessionBusy before anything is inserted.
        """
        raise NotImplementedError

    @abstractmethod
    async def mark_turn_running(self, *, turn_id: str) -> Turn:
        """Apply only pending -> running, stamping started_at."""
        raise NotImplementedError

    @abstractmethod
    async def load_completed_context(
        self, *, session_id: str, current_turn_id: str
    ) -> list[Message]:
        """Messages from completed turns plus the current turn's user message,
        sequence ASC; failed/cancelled/interrupted turns are excluded from model
        context but stay queryable via list_messages."""
        raise NotImplementedError

    @abstractmethod
    async def complete_turn(self, *, turn_id: str, assistant_message: str) -> Turn:
        """Insert the final assistant message and apply running -> completed in
        one transaction."""
        raise NotImplementedError

    @abstractmethod
    async def fail_turn(self, *, turn_id: str, error: str) -> Turn:
        """Apply pending|running -> failed once with a JSON-object error string."""
        raise NotImplementedError

    @abstractmethod
    async def cancel_turn(self, *, turn_id: str) -> Turn:
        """Apply pending|running -> cancelled once."""
        raise NotImplementedError

    @abstractmethod
    async def interrupt_turn(self, *, turn_id: str, error: str) -> Turn:
        """Apply pending|running -> interrupted once with a JSON-object error."""
        raise NotImplementedError

    @abstractmethod
    async def list_messages(self, *, session_id: str) -> list[Message]:
        """All messages ordered by sequence ASC regardless of owning turn state."""
        raise NotImplementedError

    @abstractmethod
    async def interrupt_incomplete_turns(self) -> int:
        """Startup recovery: flip every leftover pending/running turn to
        interrupted. Returns the number of rows changed."""
        raise NotImplementedError
