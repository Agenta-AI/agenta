"""Typed errors for the agent runtime."""

from __future__ import annotations

from typing import TYPE_CHECKING

from agenta.sdk.engines.running.errors import ERRORS_BASE_URL, ErrorStatus

from .dtos import HarnessKind
from .tools.errors import ToolResolutionError

__all__ = [
    "AgentRunnerConfigurationError",
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


class LocalSandboxNotAllowedError(ErrorStatus):
    """A sandbox provider not in `AGENTA_RUNNER_ENABLED_SANDBOX_PROVIDERS`; maps to HTTP 403."""

    code: int = 403
    type: str = f"{ERRORS_BASE_URL}#v0:agent:local-sandbox-not-allowed"

    def __init__(
        self,
        sandbox: str = "local",
        message: str = None,
    ) -> None:
        resolved = message or (
            f"sandbox '{sandbox}' is not enabled on this deployment "
            f"(add it to AGENTA_RUNNER_ENABLED_SANDBOX_PROVIDERS to enable)"
        )
        super().__init__(code=self.code, type=self.type, message=resolved)
