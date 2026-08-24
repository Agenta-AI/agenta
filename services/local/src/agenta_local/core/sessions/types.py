"""Typed session-domain failures and turn-lifecycle rules (contracts.md)."""

from ..exceptions import DomainError
from .dtos import TurnStatus


class SessionNotFound(DomainError):
    code = "session_not_found"


class SessionBusy(DomainError):
    """Another pending/running turn owns the session's single active slot."""

    code = "session_busy"
    retryable = True


class TurnNotFound(DomainError):
    code = "turn_not_found"


class TurnAlreadyExists(DomainError):
    """Reserved name from contracts.md; exact-duplicate replays return the row."""

    code = "turn_already_exists"


class IdempotencyConflict(DomainError):
    """client_turn_id reused with a different input_hash."""

    code = "idempotency_conflict"


class TurnNotActive(DomainError):
    """The turn state does not allow the requested transition or append."""

    code = "turn_not_active"


TERMINAL_TURN_STATUSES = frozenset(
    {
        TurnStatus.COMPLETED,
        TurnStatus.FAILED,
        TurnStatus.CANCELLED,
        TurnStatus.INTERRUPTED,
    }
)

# Only running may become completed (contracts.md "SQLite records").
ALLOWED_TURN_TRANSITIONS: dict[TurnStatus, frozenset[TurnStatus]] = {
    TurnStatus.PENDING: frozenset(
        {
            TurnStatus.RUNNING,
            TurnStatus.FAILED,
            TurnStatus.CANCELLED,
            TurnStatus.INTERRUPTED,
        }
    ),
    TurnStatus.RUNNING: frozenset(
        {
            TurnStatus.COMPLETED,
            TurnStatus.FAILED,
            TurnStatus.CANCELLED,
            TurnStatus.INTERRUPTED,
        }
    ),
}
