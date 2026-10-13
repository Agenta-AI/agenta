from typing import Any, Dict, Optional


class BrowserProfileError(Exception):
    def __init__(self, message: str):
        self.message = message
        super().__init__(message)


class BrowserProfileNotFound(BrowserProfileError):
    def __init__(self, message: str = "Browser profile not found."):
        super().__init__(message)


class BrowserProfileHostInvalid(BrowserProfileError):
    def __init__(self, host: str, reason: str):
        super().__init__(f"'{host}' is not an allowed site: {reason}")


class BrowserLoginNotStarted(BrowserProfileError):
    def __init__(self, message: str = "No login browser is running for this profile."):
        super().__init__(message)


class BrowserToolError(BrowserProfileError):
    """An agent-actionable failure, shaped as the canonical envelope (see api/AGENTS.md)."""

    def __init__(
        self,
        *,
        code: str,
        message: str,
        retryable: bool = False,
        next_step: Optional[str] = None,
        details: Optional[Dict[str, Any]] = None,
    ):
        self.code = code
        self.retryable = retryable
        self.next_step = next_step
        self.details = details
        super().__init__(message)

    def to_detail(self) -> Dict[str, Any]:
        return {
            "code": self.code,
            "message": self.message,
            "retryable": self.retryable,
            "next_step": self.next_step,
            "details": self.details,
        }


class BrowserUnavailable(BrowserToolError):
    def __init__(self, message: str = "The cloud browser is not reachable right now."):
        super().__init__(
            code="browser_unavailable",
            message=message,
            retryable=True,
            next_step="Try the browser action again in a minute.",
        )


class BrowserDisabled(BrowserToolError):
    def __init__(self):
        super().__init__(
            code="browser_disabled",
            message="The cloud browser is not enabled on this deployment.",
            retryable=False,
        )


def profile_not_available() -> BrowserToolError:
    return BrowserToolError(
        code="profile_not_available",
        message="The browser profile of this agent is not available to this run.",
        retryable=False,
        next_step="Ask the profile owner to run the agent, or attach a profile you own.",
    )


def profile_needs_login() -> BrowserToolError:
    return BrowserToolError(
        code="profile_needs_login",
        message="The browser profile is not logged in yet.",
        retryable=False,
        next_step="Ask the profile owner to log in to the profile in Settings.",
    )
