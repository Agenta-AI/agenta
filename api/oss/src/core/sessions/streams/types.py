"""Domain exceptions for session streams."""

from typing import Optional


class SessionStreamError(Exception):
    """Base exception for session stream errors."""


class SessionIdInvalid(SessionStreamError):
    def __init__(self, session_id: str):
        self.session_id = session_id
        self.message = f"Session id '{session_id}' is invalid."
        super().__init__(self.message)


class SessionStreamNotFound(SessionStreamError):
    def __init__(self, session_id: str):
        self.session_id = session_id
        self.message = f"No stream found for session '{session_id}'."
        super().__init__(self.message)


class SessionStreamAlreadyExists(SessionStreamError):
    def __init__(self, session_id: str):
        self.session_id = session_id
        self.message = f"A stream already exists for session '{session_id}'."
        super().__init__(self.message)


class SessionTurnInUse(SessionStreamError):
    """Raised when a session is already alive and force=False (a turn is in use)."""

    def __init__(self, session_id: str, liveness: dict):
        self.session_id = session_id
        self.liveness = liveness
        self.message = f"Session '{session_id}' already has an active turn."
        super().__init__(self.message)


class SessionTurnMismatch(SessionStreamError):
    """Raised when a cancel would displace a turn the caller did not mean to cancel.

    Two ways to get here, one meaning: the Stop is stale. Either the caller named a turn
    (`expected_execution_id`) and a different one now holds the session, or the caller named
    none and the holding turn started after the cancel arrived. Both are the stop-then-send
    race: the turn the user meant has already ended and the next one has taken the session.
    """
    def __init__(
        self,
        session_id: str,
        *,
        actual_turn_id: Optional[str] = None,
        expected_turn_id: Optional[str] = None,
    ):
        self.session_id = session_id
        self.actual_turn_id = actual_turn_id
        self.expected_turn_id = expected_turn_id
        if expected_turn_id:
            self.message = (
                f"Session '{session_id}' is running turn '{actual_turn_id}',"
                f" not the expected turn '{expected_turn_id}'."
                " Nothing was cancelled."
            )
        else:
            self.message = (
                f"Session '{session_id}' started turn '{actual_turn_id}' after this"
                " cancel arrived, so the cancel is stale. Nothing was cancelled."
                " Send `expected_execution_id` to cancel a specific turn."
            )
        super().__init__(self.message)


class ConcurrencyLimitExceeded(SessionStreamError):
    """Raised when the per-project concurrent-run limit is exceeded."""

    def __init__(self, limit: int):
        self.limit = limit
        self.message = (
            f"Concurrency limit of {limit} concurrent runs reached for this project."
        )
        super().__init__(self.message)
