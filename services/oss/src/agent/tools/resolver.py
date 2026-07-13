"""Service-side resolution wiring.

The three resolution entrypoints now live in the SDK (``agenta.sdk.agents.platform``) so the
service and a standalone SDK user share them. ``resolve_tools`` is re-exported as-is, and the
MCP deployment gate (``AGENTA_AGENT_MCPS_ENABLED``, off by default) is the SDK's
``resolve_mcp_servers_gated`` — the service used to keep a byte-identical copy of it (SVC-4).
"""

from __future__ import annotations

from typing import Any, List, Optional, Sequence

from agenta.sdk.agents.handler import resolve_mcp_servers_gated
from agenta.sdk.agents.mcp import ResolvedMCPServer
from agenta.sdk.agents.platform import resolve_tools
from agenta.sdk.agents.tools.interfaces import ToolSecretProvider

__all__ = ["resolve_tools", "resolve_mcp_servers"]


async def resolve_mcp_servers(
    mcp_servers: Sequence[Any],
    *,
    secret_provider: Optional[ToolSecretProvider] = None,
) -> List[ResolvedMCPServer]:
    """Resolve MCP servers, gated by ``AGENTA_AGENT_MCPS_ENABLED`` (off by default).

    Thin named seam over the SDK's shared gate, kept so the service's tests and composition
    keep patching ``oss.src.agent.tools.resolve_mcp_servers`` as they always have.
    """
    return await resolve_mcp_servers_gated(mcp_servers, secret_provider=secret_provider)
