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


class MCPDisabledError(MCPError):
    """The deployment disabled MCP, but the request still declared ``mcp_servers``.

    Raised instead of silently dropping the servers, so the user learns their MCP config was
    ignored rather than wondering why the run behaved as if it had no servers. The fail-loud
    MCP guards in the runner never see these servers (resolution strips them before the wire),
    so this is the boundary that must surface the disabled state.
    """

    def __init__(self, *, server_names: Sequence[str]) -> None:
        names = tuple(server_names)
        listed = ", ".join(names) if names else "(unnamed)"
        super().__init__(
            "MCP servers are disabled on this deployment "
            "(set AGENTA_AGENT_ENABLE_MCP to enable them), but the request declared "
            f"{len(names)} MCP server(s): {listed}. Remove them or enable MCP."
        )
        self.server_names = names


class MissingMCPSecretError(MCPError):
    def __init__(self, *, server_name: str, secret_names: Sequence[str]) -> None:
        names = tuple(secret_names)
        super().__init__(
            f"MCP server '{server_name}' is missing required secret(s): "
            f"{', '.join(names)}"
        )
        self.server_name = server_name
        self.secret_names = names
