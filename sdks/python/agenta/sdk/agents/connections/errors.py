"""Errors raised while resolving an agent connection.

The resolution rules (in the design's Concern 3) are deterministic and fail-loud: a missing
slug, an ambiguous match, a provider mismatch, or an unsupported provider/mode each raise a
specific subclass rather than silently picking a credential by iteration order. Slice 1
defines the full set so the module is complete; the service-backed resolver (Slice 2) raises
them.
"""

from __future__ import annotations

from typing import Optional


class AgentConnectionError(Exception):
    """Base error for the agent connections domain.

    Named ``AgentConnectionError`` (not ``ConnectionError``) so it never shadows Python's
    builtin ``ConnectionError`` in this namespace, where network I/O (``platform/secrets.py``)
    can raise the builtin.
    """


class ConnectionResolutionError(AgentConnectionError):
    """Raised when a connection cannot be resolved into a credential plan."""


class ConnectionNotFoundError(ConnectionResolutionError):
    """Raised when a named connection (``mode == agenta`` + ``slug``) does not exist."""

    def __init__(self, *, slug: str, provider: Optional[str] = None) -> None:
        suffix = f" for provider '{provider}'" if provider else ""
        super().__init__(f"connection '{slug}' not found{suffix}")
        self.slug = slug
        self.provider = provider


class AmbiguousConnectionError(ConnectionResolutionError):
    """Raised when more than one connection matches and resolution cannot pick one."""

    def __init__(self, *, provider: str, slug: Optional[str] = None) -> None:
        if slug:
            message = (
                f"ambiguous connection '{slug}' for provider '{provider}'; "
                "connection names must be unique to resolve"
            )
        else:
            message = (
                f"multiple connections for provider '{provider}'; "
                "name one in the config"
            )
        super().__init__(message)
        self.provider = provider
        self.slug = slug


class ProviderMismatchError(ConnectionResolutionError):
    """Raised when a resolved connection's provider does not match the model's provider."""

    def __init__(self, *, expected: str, actual: str) -> None:
        super().__init__(
            f"connection provider '{actual}' does not match model provider '{expected}'"
        )
        self.expected = expected
        self.actual = actual


class UnsupportedProviderError(ConnectionResolutionError):
    """Raised when the requested provider cannot be reached by the selected harness."""

    def __init__(self, *, provider: str, harness: Optional[str] = None) -> None:
        suffix = f" by harness '{harness}'" if harness else ""
        super().__init__(f"provider '{provider}' is not supported{suffix}")
        self.provider = provider
        self.harness = harness


class UnsupportedConnectionModeError(ConnectionResolutionError):
    """Raised when the requested connection mode cannot be used by the selected harness."""

    def __init__(self, *, mode: str, harness: Optional[str] = None) -> None:
        suffix = f" by harness '{harness}'" if harness else ""
        super().__init__(f"connection mode '{mode}' is not supported{suffix}")
        self.mode = mode
        self.harness = harness
