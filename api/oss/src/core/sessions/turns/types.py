"""Domain exceptions for session turns."""


class SessionTurnError(Exception):
    """Base exception for session turn errors."""


class SessionTurnNotFound(SessionTurnError):
    def __init__(self, session_id: str, turn_index: int):
        self.session_id = session_id
        self.turn_index = turn_index
        self.message = f"No turn {turn_index} found for session '{session_id}'."
        super().__init__(self.message)


class SessionTurnStreamMismatch(SessionTurnError):
    """The turn's stream is not the row of its session (another session's row, or a
    session with no row). Nothing is appended."""

    def __init__(self, session_id: str):
        self.session_id = session_id
        self.message = f"The turn's stream is not the row of session '{session_id}'."
        super().__init__(self.message)
