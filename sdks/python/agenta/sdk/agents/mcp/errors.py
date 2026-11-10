"""Errors raised while parsing and resolving MCP server configuration."""

from __future__ import annotations

from typing import Sequence

from ..config_errors import ConfigEntryError


class MCPError(RuntimeError):
    """Base error for the agent MCP subsystem."""


class MCPConfigurationError(MCPError, ConfigEntryError):
    """An ``mcps`` entry the runtime cannot parse."""


class MissingMCPSecretError(MCPError):
    def __init__(self, *, server_name: str, secret_names: Sequence[str]) -> None:
        names = tuple(secret_names)
        super().__init__(
            f"MCP server '{server_name}' is missing required secret(s): "
            f"{', '.join(names)}"
        )
        self.server_name = server_name
        self.secret_names = names


class MCPServerURLBlockedError(MCPError):
    """An MCP server's ``url`` failed the SSRF guard (private/loopback/link-local/metadata)."""

    def __init__(self, *, server_name: str, url: str) -> None:
        super().__init__(
            f"MCP server '{server_name}' url is blocked by the outbound egress guard: {url}"
        )
        self.server_name = server_name
        self.url = url


class MCPGatewayUnavailableError(MCPError):
    """A platform MCP route was selected without platform credentials."""

    def __init__(self, *, server_name: str) -> None:
        super().__init__(
            f"MCP server '{server_name}' selects a gateway route, but no Agenta "
            "gateway connection is configured"
        )
        self.server_name = server_name
