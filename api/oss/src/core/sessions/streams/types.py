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
    ) -> None:
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


#: How much of a session name the refusal message repeats. The runner cuts a tool error at
#: 2000 characters, and a name is unbounded at this API, so an unbounded echo would push the
#: machine-readable half of the envelope off the end. `details.current_name` carries it whole.
NAME_ECHO_MAX_CHARS = 120


def _echo(name: str) -> str:
    if len(name) <= NAME_ECHO_MAX_CHARS:
        return name
    return name[:NAME_ECHO_MAX_CHARS] + "..."


class SessionNameProtected(SessionStreamError):
    """Raised when an automatic rename would take a name away from the person who chose it.

    The agent decides a `rename_session` call's arguments at one moment and can run them at
    a later one: an approval card holds the call while the person renames the session by
    hand, and the deferred call then writes the name the agent chose before that rename. The
    agent reports the stale name afterwards, so the person sees their name silently
    reverted.

    Three ways to get here, one meaning: the caller is acting on a session state that is no
    longer the current one, or on an authority it does not have.

    - `session_name_is_manual`: it named nothing it was replacing.
    - `session_name_changed`: it named one, and the session has moved on since. The name and
      the revision are checked together. The name is what a person recognizes and is not
      guessable; the revision is what makes an authorization single-use, so restoring an
      earlier name does not revive a request that already ran against it.
    - `session_name_clear_is_manual`: it tried to remove the name entirely. Only a person
      does that, and an automatic clear would otherwise leave the row with nothing to
      protect.

    The current name and revision ride on the exception because the caller is usually a
    model, and the useful answer is not "refused" but "here is where the session actually is".
    """

    def __init__(
        self,
        session_id: str,
        current_name: str,
        *,
        name_revision: Optional[int] = None,
        stale_precondition: bool = False,
        clearing: bool = False,
    ) -> None:
        self.session_id = session_id
        self.current_name = current_name
        self.name_revision = name_revision
        self.stale_precondition = stale_precondition
        self.clearing = clearing
        echoed = _echo(current_name)
        if clearing:
            self.code = "session_name_clear_is_manual"
            self.message = (
                f'This session is named "{echoed}", and only a person can remove'
                " a session's name."
            )
            self.next_step = (
                "Keep the name. If the person wants it gone, tell them to clear it"
                " themselves."
            )
        elif stale_precondition:
            self.code = "session_name_changed"
            self.message = (
                f'This session is named "{echoed}" now, which is not the name you asked'
                " to replace, so the rename was not applied."
            )
            self.next_step = (
                f'Tell the person the session is called "{echoed}". Rename it only if they'
                " still want a different name, and send replacing_name and"
                " replacing_revision set to the values below."
            )
        else:
            self.code = "session_name_is_manual"
            self.message = f'This session is named "{echoed}", and a person named it.'
            self.next_step = (
                "Keep that name and do not rename the session. Only if the person asked you"
                " for a different one, send replacing_name and replacing_revision set to the"
                " values below."
            )
        super().__init__(self.message)

    def envelope(self) -> dict:
        """The agent-actionable error body (`api/AGENTS.md`, "Agent-actionable errors")."""
        return {
            "code": self.code,
            "message": self.message,
            "retryable": False,
            "next_step": self.next_step,
            "details": {
                "current_name": self.current_name,
                "name_revision": self.name_revision,
            },
        }
