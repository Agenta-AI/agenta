"""Typed errors for the agent runtime."""

from __future__ import annotations

from typing import TYPE_CHECKING, Any, Dict, Optional

from agenta.sdk.engines.running.errors import ERRORS_BASE_URL, ErrorStatus

from .dtos import HarnessKind
from .tools.errors import ToolResolutionError

__all__ = [
    "AgentRunFailed",
    "AgentTurnAdmissionRefused",
    "AgentRunnerConfigurationError",
    "SandboxNotAllowedError",
    "LocalSandboxNotAllowedError",
    "UnsupportedHarnessError",
    "ToolResolutionError",
]

if TYPE_CHECKING:
    from .interfaces import Backend


class UnsupportedHarnessError(RuntimeError):
    """Raised when a harness is asked to run on a backend that cannot drive it."""

    def __init__(self, harness: HarnessKind, backend: "Backend") -> None:
        supported = ", ".join(sorted(h.value for h in backend.supported_harnesses))
        super().__init__(
            f"{type(backend).__name__} cannot drive harness '{harness.value}'; "
            f"it supports: {supported or '(none)'}"
        )
        self.harness = harness
        self.backend = backend


class AgentRunnerConfigurationError(RuntimeError):
    """Raised when a runner-backed adapter lacks a usable transport configuration."""


class AgentRunFailed(RuntimeError):
    """A runner-reported terminal failure with a stable machine-readable code.

    ``error_detail`` carries the platform's agent-actionable envelope
    (``{code, message, retryable, next_step?, details?}``, api/AGENTS.md) when the runner
    recovered one from a gateway data-plane refusal (`gateway-error.ts`
    `parseGatewayErrorDetail`); absent for every other failure, unchanged from before. When
    present, ``failure_code`` becomes ITS ``code`` (e.g. ``model_not_allowed``) instead of the
    generic default, so a caller matching on `failure_code` gets the real cause.
    """

    failure_code: str = "agent_run_failed"

    def __init__(
        self, message: str, error_detail: Optional[Dict[str, Any]] = None
    ) -> None:
        self.message = message
        self.error_detail = error_detail if isinstance(error_detail, dict) else None
        if self.error_detail and isinstance(self.error_detail.get("code"), str):
            self.failure_code = self.error_detail["code"]
        super().__init__(f"Agent run failed: {message}")


class SandboxNotAllowedError(ErrorStatus):
    """A sandbox provider not in `AGENTA_RUNNER_ENABLED_SANDBOX_PROVIDERS`; maps to HTTP 403."""

    code: int = 403
    type: str = f"{ERRORS_BASE_URL}#v0:agent:sandbox-provider-not-allowed"

    def __init__(
        self,
        sandbox: str = "local",
        message: Optional[str] = None,
    ) -> None:
        how = (
            "it is enabled together with 'daytona'; add daytona to "
            "AGENTA_RUNNER_ENABLED_SANDBOX_PROVIDERS to enable"
            if sandbox == "inprocess"
            else "add it to AGENTA_RUNNER_ENABLED_SANDBOX_PROVIDERS to enable"
        )
        resolved = message or (
            f"sandbox '{sandbox}' is not enabled on this deployment ({how})"
        )
        super().__init__(code=self.code, type=self.type, message=resolved)
        self.sandbox = sandbox


# Backward-compatible alias: the class was named after the default 'local' provider even
# though it covers every refused provider (#5575).
LocalSandboxNotAllowedError = SandboxNotAllowedError


# The `errorDetail.code` values the runner puts on a turn it refused at admission
# (`services/runner/src/sessions/admission.ts`).
SESSION_TURN_IN_USE_CODE = "session_turn_in_use"
SESSION_ADMISSION_UNCONFIRMED_CODE = "session_admission_unconfirmed"
SESSION_ADMISSION_REJECTED_CODE = "session_admission_rejected"

# How long a caller should wait before sending a turn whose admission the platform did not
# answer. The runner has already asked for about 30 seconds, so the platform is throttling or
# restarting; a few seconds is enough for the next send to find it again.
ADMISSION_RETRY_AFTER_SECONDS = 5


class AgentTurnAdmissionRefused(AgentRunFailed):
    """The runner refused the turn before it started, so nothing ran and nothing was sent.

    The runner names why in ``errorDetail.code``, and the invoke answers with the matching status:

    * ``session_turn_in_use``: another turn owns the session. 409.
    * ``session_admission_unconfirmed``: the platform did not answer the admission (throttled or
      restarting). 503 with ``Retry-After``.
    * ``session_admission_rejected``: the platform refused the admission as a request error. 422.

    ``failure_code`` stays ``session_turn_in_use`` for the first two, because that is the code the
    web chat and the channels inbox read as "not sent, send again". The message is the runner's
    own sentence, with no prefix, so a client that matches it exactly still does.
    """

    CODES = frozenset(
        {
            SESSION_TURN_IN_USE_CODE,
            SESSION_ADMISSION_UNCONFIRMED_CODE,
            SESSION_ADMISSION_REJECTED_CODE,
        }
    )

    def __init__(self, message: str, error_detail: Dict[str, Any]) -> None:
        super().__init__(message, error_detail=error_detail)
        self.retry_after: Optional[int] = None
        reason = error_detail.get("code")
        if reason == SESSION_ADMISSION_REJECTED_CODE:
            self.status_code = 422
            self.failure_code = SESSION_ADMISSION_REJECTED_CODE
        elif reason == SESSION_ADMISSION_UNCONFIRMED_CODE:
            self.status_code = 503
            self.retry_after = ADMISSION_RETRY_AFTER_SECONDS
            self.failure_code = SESSION_TURN_IN_USE_CODE
        else:
            self.status_code = 409
            self.failure_code = SESSION_TURN_IN_USE_CODE

    @classmethod
    def matches(cls, error_detail: Optional[Dict[str, Any]]) -> bool:
        if not isinstance(error_detail, dict):
            return False
        code = error_detail.get("code")
        # A non-string code (a list, a dict) is unhashable; it is not ours either way.
        return isinstance(code, str) and code in cls.CODES

    def __str__(self) -> str:
        return self.message
