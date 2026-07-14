"""Service-side tool and MCP resolution wiring."""

from __future__ import annotations

from typing import Any, List, Optional, Sequence

from agenta.sdk.agents.mcp import ResolvedMCPServer
from agenta.sdk.agents.platform import resolve_mcp, resolve_tools
from agenta.sdk.agents.tools.interfaces import ToolSecretProvider

__all__ = ["resolve_tools", "resolve_mcp_servers"]


async def resolve_mcp_servers(
    mcp_servers: Sequence[Any],
    *,
    secret_provider: Optional[ToolSecretProvider] = None,
) -> List[ResolvedMCPServer]:
    """Resolve external MCP server declarations for one run."""
    return await resolve_mcp(mcp_servers, secret_provider=secret_provider)
