from typing import Optional


class SkillsError(Exception):
    """Base for skill-registry domain errors.

    Carries the agent-actionable envelope fields: a stable lower-snake-case
    `code`, a concise `message`, `retryable` (may the SAME request succeed if
    replayed later), and an imperative `next_step` when the caller must act.
    """

    code: str = "skills_error"
    retryable: bool = False

    def __init__(
        self,
        message: str,
        *,
        next_step: Optional[str] = None,
        details: Optional[dict] = None,
    ):
        self.message = message
        self.next_step = next_step
        self.details = details or {}
        super().__init__(message)


class SkillSourceFetchError(SkillsError):
    """The repo/marketplace could not be fetched."""

    code = "source_fetch_failed"
    retryable = True


class SkillSourceInvalidURLError(SkillsError):
    code = "source_url_invalid"
    retryable = False


class SkillSourceTooLargeError(SkillsError):
    code = "source_too_large"
    retryable = False


class SkillSourceNotFoundError(SkillsError):
    code = "source_not_found"
    retryable = False


class SkillNameCollisionError(SkillsError):
    code = "name_collision"
    retryable = False
