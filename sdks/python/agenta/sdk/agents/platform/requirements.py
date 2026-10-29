"""Which MCP servers an agent names are not ready, asked of the platform at run start.

The run routes every MCP server through the gateway, which learns that a server is gone
or signed out only at the first tool call. This asks the needs-setup check instead, for
the MCP servers only, so the run can leave those servers out. One request, sent beside
the other resolve calls, so it adds no wait. Best effort: a failure keeps every server,
which is the behavior before this check existed.
"""

from __future__ import annotations

from typing import Optional, Sequence, Set

import httpx

from agenta.sdk.utils.logging import get_module_logger

from ..mcp import MCPGatewayConnection, MCPServerConfig
from ..requirements import KIND_MCP_SERVER, KIND_MCP_SIGN_IN
from .connection import PlatformConnection

log = get_module_logger(__name__)


def _checked(server: MCPServerConfig) -> bool:
    connection = server.connection
    return (
        isinstance(connection, MCPGatewayConnection)
        and connection.namespace == "custom"
        and bool(connection.slug)
        # A "user" server is the gateway's to leave out (no account in the run's claim),
        # so the run start sends nothing for it.
        and getattr(connection, "account_source", None) != "user"
    )


async def unready_mcp_servers(
    mcp_servers: Sequence[MCPServerConfig],
    *,
    connection: Optional[PlatformConnection] = None,
) -> Set[str]:
    """The slugs of the named MCP servers that are missing, turned off or signed out."""
    servers = [server for server in mcp_servers if _checked(server)]
    if not servers:
        return set()

    connection = connection or PlatformConnection()
    api_base = connection.base_url()
    if not api_base:
        return set()

    body = {
        "parameters": {
            "agent": {
                "mcps": [
                    server.model_dump(mode="json", exclude_none=True)
                    for server in servers
                ]
            }
        }
    }
    try:
        async with httpx.AsyncClient(timeout=connection.timeout) as client:
            response = await client.post(
                f"{api_base}/workflows/revisions/requirements/query",
                headers=connection.headers(),
                json=body,
            )
        if response.status_code >= 400:
            log.warning("agent: MCP readiness check HTTP %s", response.status_code)
            return set()
        payload = response.json()
    except Exception:  # pylint: disable=broad-except
        log.warning("agent: MCP readiness check failed", exc_info=True)
        return set()

    requirements = payload.get("requirements") if isinstance(payload, dict) else None
    unready = {
        str(item["reference"]["slug"])
        for item in requirements or []
        if isinstance(item, dict)
        and item.get("kind") in (KIND_MCP_SERVER, KIND_MCP_SIGN_IN)
        and isinstance(item.get("reference"), dict)
        and item["reference"].get("slug")
    }
    if unready:
        log.info("agent: %d MCP server(s) left out of the run", len(unready))
    return unready
