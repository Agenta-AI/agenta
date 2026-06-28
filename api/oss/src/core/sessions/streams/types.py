"""Domain exceptions for session streams."""


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


class SessionRunInUse(SessionStreamError):
    """Raised when a run is already alive and force=False."""

    def __init__(self, session_id: str, liveness: dict):
        self.session_id = session_id
        self.liveness = liveness
        self.message = f"Session '{session_id}' already has an active run."
        super().__init__(self.message)


class ConcurrencyCapExceeded(SessionStreamError):
    """Raised when the per-replica concurrency cap is exceeded."""

    def __init__(self, cap: int):
        self.cap = cap
        self.message = (
            f"Concurrency cap of {cap} concurrent runs reached on this replica."
        )
        super().__init__(self.message)
