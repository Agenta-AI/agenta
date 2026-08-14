"""Typed errors for the agent runtime."""

from __future__ import annotations

from typing import TYPE_CHECKING, Any, Dict, Optional

from agenta.sdk.engines.running.errors import ERRORS_BASE_URL, ErrorStatus

from .dtos import HarnessKind
from .tools.errors import ToolResolutionError

__all__ = [
    "AgentRunFailed",
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
        self.error_detail = error_detail
        if error_detail and isinstance(error_detail.get("code"), str):
            self.failure_code = error_detail["code"]
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
        resolved = message or (
            f"sandbox '{sandbox}' is not enabled on this deployment "
            f"(add it to AGENTA_RUNNER_ENABLED_SANDBOX_PROVIDERS to enable)"
        )
        super().__init__(code=self.code, type=self.type, message=resolved)
        self.sandbox = sandbox


# Backward-compatible alias: the class was named after the default 'local' provider even
# though it covers every refused provider (#5575).
LocalSandboxNotAllowedError = SandboxNotAllowedError
