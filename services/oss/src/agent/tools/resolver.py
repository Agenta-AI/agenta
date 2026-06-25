"""Service-side resolution wiring.

The three resolution entrypoints now live in the SDK (``agenta.sdk.agents.platform``) so the
service and a standalone SDK user share them. ``resolve_tools`` is re-exported as-is; the
service only adds the MCP deployment gate (``AGENTA_AGENT_MCP_SERVERS_ENABLED``, off by
default) on top of the SDK's ``resolve_mcp``.
"""

from __future__ import annotations

import os
from typing import Any, List, Optional, Sequence

from agenta.sdk.agents.mcp import ResolvedMCPServer
from agenta.sdk.agents.platform import resolve_mcp, resolve_tools
from agenta.sdk.agents.tools.interfaces import ToolSecretProvider
from agenta.sdk.utils.constants import TRUTHY

__all__ = ["resolve_tools", "resolve_mcp_servers"]


def _mcp_enabled() -> bool:
    return os.getenv("AGENTA_AGENT_MCP_SERVERS_ENABLED", "").strip().lower() in TRUTHY


async def resolve_mcp_servers(
    mcp_servers: Sequence[Any],
    *,
    secret_provider: Optional[ToolSecretProvider] = None,
) -> List[ResolvedMCPServer]:
    """Resolve MCP servers, gated by ``AGENTA_AGENT_MCP_SERVERS_ENABLED`` (off by default).

    Returns the resolved servers when enabled, an empty list when not.
    """
    if not _mcp_enabled():
        return []
    return await resolve_mcp(mcp_servers, secret_provider=secret_provider)
