"""Exceptions of the sharing domain.

Each `SharingError` carries the error `code` the API answers with (interfaces section 5),
a `message` and `details`. Routes and worker boundaries map them by name, before any
generic catch.
"""

from typing import Any, Dict, Optional
from uuid import UUID

from oss.src.core.access.types import AccessDenied
from oss.src.core.sharing.dtos import AccessPolicy


class SharingError(Exception):
    """Base for the sharing domain."""

    code: str = "sharing_error"

    def __init__(self, message: str, *, details: Optional[Dict[str, Any]] = None):
        self.message = message
        self.details: Dict[str, Any] = dict(details or {})
        super().__init__(message)


class SharingConflict(SharingError):
    """The policy under the row lock is not the `expected` one. `current` is the
    committed policy (None: the agent has no access row)."""

    code = "sharing_conflict"

    def __init__(self, *, current: Optional[AccessPolicy]):
        self.current = current
        super().__init__("The sharing state changed.")


class InvalidGrantee(SharingError):
    """A grantee that is not an active human member, is the owner, or is named twice."""

    code = "invalid_grantee"

    def __init__(self, *, user_id: UUID, reason: str):
        self.user_id = user_id
        self.reason = reason
        super().__init__(
            "The user cannot get this grant.",
            details={"user_id": str(user_id), "reason": reason},
        )


class SessionNotShareable(SharingError):
    """A channel session, an ownerless session, or a session that runs no agent.
    `reason` is `channel`, `ownerless` or `no_agent`."""

    code = "session_not_shareable"

    def __init__(self, *, reason: str):
        self.reason = reason
        super().__init__("This session cannot be shared.", details={"reason": reason})


class SessionUsedPersonalAccounts(SessionNotShareable):
    """A run of the session used a person's own credential (M7). The mark never clears,
    so the session stays private; a new session can be shared."""

    def __init__(self):
        SharingError.__init__(
            self,
            "This conversation used your personal accounts. Start a new conversation "
            "to share with others.",
            details={"reason": "personal_credentials"},
        )
        self.reason = "personal_credentials"


class OwnerStillActive(SharingError):
    """Take ownership while the owner is still an active member."""

    code = "owner_active"

    def __init__(self):
        super().__init__("The owner is still a member of the project.")


class InvalidTransferTarget(SharingError):
    """The transfer target is not an active human member, or is the owner."""

    code = "invalid_transfer_target"

    def __init__(self, *, user_id: UUID):
        self.user_id = user_id
        super().__init__(
            "The user cannot own this agent.", details={"user_id": str(user_id)}
        )


class SharedItemNotFound(SharingError):
    """No such agent or session in the project (or one the caller may not see)."""

    code = "not_found"

    def __init__(self):
        super().__init__("Not found.")


class AgentCreationFailed(SharingError):
    """The artifact and its access row did not commit; the transaction rolled back."""

    code = "agent_creation_failed"

    def __init__(self):
        super().__init__("The agent was not created.")


class SharingServiceNotRegistered(RuntimeError):
    """A process called `get_sharing_service()` before `bootstrap_access()`."""


class AdmissionDenied(AccessDenied):
    """`RunAdmission` refused a run.

    `readable` is True when the caller may read the session but not act on it, so a
    route answers 403 (`access_denied`) or 404 (`not_found`) without a second check.
    `boundary` names the place that refused (heartbeat, queued dispatch, ...), for logs.
    """

    def __init__(
        self,
        *,
        decision,
        readable: bool,
        boundary: str,
        message: str = "Access denied",
    ):
        self.readable = readable
        self.boundary = boundary
        super().__init__(decision=decision, message=message)
