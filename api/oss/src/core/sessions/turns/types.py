"""Domain exceptions for session turns."""


class SessionTurnError(Exception):
    """Base exception for session turn errors."""


class SessionTurnNotFound(SessionTurnError):
    def __init__(self, turn_id: str):
        self.turn_id = turn_id
        self.message = f"No turn found with id '{turn_id}'."
        super().__init__(self.message)
