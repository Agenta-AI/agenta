"""Domain errors of the session commands plane. The router maps each to a status code."""

from typing import Optional


class SessionCommandError(Exception):
    """Base of every commands-plane domain error."""


class ExecutionExpectationFailed(SessionCommandError):
    """`expected_execution_id` does not name the execution that is running.

    Carries the current execution id (or None) so the caller can refresh rather than guess.
    """

    def __init__(self, *, expected: str, current: Optional[str]) -> None:
        self.expected = expected
        self.current = current
        self.message = (
            f"expected execution '{expected}' is not the running execution "
            f"(current: {current or 'none'})"
        )
        super().__init__(self.message)


class SessionCommandNotFound(SessionCommandError):
    def __init__(self, *, command_id: str) -> None:
        self.command_id = command_id
        self.message = f"no session command with id '{command_id}'"
        super().__init__(self.message)


class SessionCommandNotClaimable(SessionCommandError):
    """A settle arrived for a command this replica does not hold, or that is already terminal."""

    def __init__(self, *, command_id: str, state: str) -> None:
        self.command_id = command_id
        self.state = state
        self.message = f"session command '{command_id}' is '{state}' and cannot be settled by this caller"
        super().__init__(self.message)
