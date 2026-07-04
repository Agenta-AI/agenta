"""Service-side resolution wiring.

The three resolution entrypoints now live in the SDK (``agenta.sdk.agents.platform``) so the
service and a standalone SDK user share them. ``resolve_tools`` is re-exported as-is; the
service only adds the MCP deployment gate (``AGENTA_AGENT_MCPS_ENABLED``, on by
default; set to ``false`` to disable) on top of the SDK's ``resolve_mcp``. The gate covers
http MCP servers only, protected by the scheme+host-literal SSRF guard; DNS-rebinding and
redirect hardening is tracked separately in #4911 and is not required for this default-on
rollout.
"""

from __future__ import annotations

import os
from typing import Any, List, Optional, Sequence

from agenta.sdk.agents.mcp import MCPDisabledError, ResolvedMCPServer
from agenta.sdk.agents.mcp.parsing import parse_mcp_server_configs
from agenta.sdk.agents.platform import resolve_mcp, resolve_tools
from agenta.sdk.agents.tools.interfaces import ToolSecretProvider
from agenta.sdk.utils.constants import TRUTHY

__all__ = ["resolve_tools", "resolve_mcp_servers"]


def _mcp_enabled() -> bool:
    return os.getenv("AGENTA_AGENT_MCPS_ENABLED", "true").strip().lower() in TRUTHY


async def resolve_mcp_servers(
    mcp_servers: Sequence[Any],
    *,
    secret_provider: Optional[ToolSecretProvider] = None,
) -> List[ResolvedMCPServer]:
    """Resolve MCP servers, gated by ``AGENTA_AGENT_MCPS_ENABLED`` (on by default; set
    ``AGENTA_AGENT_MCPS_ENABLED=false`` to disable).

    When MCP is enabled, returns the resolved servers. When it is disabled and the request
    declared NO servers, returns an empty list (the common case, unchanged). When it is disabled
    but the request DID declare servers, raises :class:`MCPDisabledError` instead of silently
    stripping them — silent-stripping made the runner's fail-loud MCP guards unreachable via
    ``/invoke`` and ``/messages``, so the user got a run that quietly ignored their MCP config.
    """
    if not _mcp_enabled():
        if not mcp_servers:
            return []
        # Parse only to surface the server names in the error; do not resolve secrets (disabled).
        names = [config.name for config in parse_mcp_server_configs(mcp_servers)]
        raise MCPDisabledError(server_names=names)
    return await resolve_mcp(mcp_servers, secret_provider=secret_provider)
