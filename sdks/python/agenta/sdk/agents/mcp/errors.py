"""Errors raised while parsing and resolving MCP server configuration."""

from __future__ import annotations

from typing import Any, Optional, Sequence


class MCPError(RuntimeError):
    """Base error for the agent MCP subsystem."""


class MCPConfigurationError(MCPError):
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


class MissingMCPSecretError(MCPError):
    def __init__(self, *, server_name: str, secret_names: Sequence[str]) -> None:
        names = tuple(secret_names)
        super().__init__(
            f"MCP server '{server_name}' is missing required secret(s): "
            f"{', '.join(names)}"
        )
        self.server_name = server_name
        self.secret_names = names
