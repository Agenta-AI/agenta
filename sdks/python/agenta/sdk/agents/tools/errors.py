"""Errors raised while parsing and resolving agent tools."""

from __future__ import annotations

from typing import Any, Optional, Sequence


class ToolError(RuntimeError):
    """Base error for the agent tools domain."""


class ToolConfigurationError(ToolError):
    """Raised when tool configuration cannot be converted to a canonical model."""

    def __init__(
        self,
        message: str,
        *,
        index: Optional[int] = None,
        value: Any = None,
    ) -> None:
        super().__init__(message)
        self.index = index
        self.value = value


ToolConfigError = ToolConfigurationError


class ToolResolutionError(ToolError):
    """Raised when tool configuration cannot become runnable specifications."""

    def __init__(
        self,
        message: str,
        *,
        status: Optional[int] = None,
        ref_count: Optional[int] = None,
        spec_count: Optional[int] = None,
        provider: Optional[str] = None,
        reference: Optional[str] = None,
        detail: Optional[str] = None,
    ) -> None:
        super().__init__(message)
        self.status = status
        self.ref_count = ref_count
        self.spec_count = spec_count
        self.provider = provider
        self.reference = reference
        # Human-facing reason string from the resolver response body (the FastAPI
        # ``detail`` field). Diagnostic metadata: it travels server -> exception -> run
        # error so the user learns which tool broke without backend access. Never a secret.
        self.detail = detail


class GatewayToolResolutionError(ToolResolutionError):
    """Raised when a gateway adapter cannot resolve a configured tool."""


class UnsupportedToolProviderError(ToolResolutionError):
    """Raised when no resolver is available for a configured gateway provider."""

    def __init__(self, provider: str) -> None:
        super().__init__(
            f"Unsupported tool provider: {provider}",
            provider=provider,
        )


class MissingToolSecretError(ToolResolutionError):
    """Raised when a tool declares required secrets that a provider cannot supply."""

    def __init__(self, *, tool_name: str, secret_names: Sequence[str]) -> None:
        names = tuple(secret_names)
        super().__init__(
            f"Tool '{tool_name}' is missing required secret(s): {', '.join(names)}"
        )
        self.tool_name = tool_name
        self.secret_names = names


class DuplicateToolNameError(ToolResolutionError):
    """Raised when two configured tools resolve to the same model-visible name."""

    def __init__(self, name: str) -> None:
        super().__init__(f"Duplicate tool name: {name}")
        self.name = name


class UnknownPlatformOpError(ToolResolutionError):
    """Raised when a ``type:"platform"`` tool names an op absent from the platform-op catalog."""

    def __init__(self, *, op: str, available: Sequence[str]) -> None:
        names = ", ".join(available)
        super().__init__(
            f"Unknown platform op: '{op}'. Available ops: {names}",
            reference=op,
        )
        self.op = op
        self.available = tuple(available)
