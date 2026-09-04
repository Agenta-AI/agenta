from typing import Optional


class SessionInputError(Exception):
    pass


class SessionInputBusy(SessionInputError):
    def __init__(self, current_execution_id: Optional[str] = None):
        self.current_execution_id = current_execution_id
        super().__init__("The session is already running an execution.")


class SessionInputNotFound(SessionInputError):
    def __init__(self, input_id: str):
        self.input_id = input_id
        super().__init__("The pending input was not found.")


class SessionInputNotRemovable(SessionInputError):
    def __init__(self, input_id: str):
        self.input_id = input_id
        super().__init__("The input can no longer be removed because it was promoted.")


class SessionInputIdempotencyConflict(SessionInputError):
    def __init__(self):
        super().__init__("This idempotency key was already used for a different input.")
