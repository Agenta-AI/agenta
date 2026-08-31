"""Service-side tool and MCP resolution wiring."""

from __future__ import annotations

from typing import Any, List, Optional, Sequence

import httpx

from agenta.sdk.agents.mcp import (
    HeaderCredentialBinding,
    MCPGatewayConnection,
    ResolvedMCPCredential,
    ResolvedMCPServer,
    parse_mcp_server_configs,
)
from agenta.sdk.agents.platform import resolve_mcp, resolve_tools
from agenta.sdk.agents.platform.connection import PlatformConnection
from agenta.sdk.agents.tools.interfaces import ToolSecretProvider

__all__ = ["resolve_tools", "resolve_mcp_servers"]


async def resolve_mcp_servers(
    mcp_servers: Sequence[Any],
    *,
    secret_provider: Optional[ToolSecretProvider] = None,
    tool_specs: Sequence[Any] = (),
) -> List[ResolvedMCPServer]:
    """Resolve external MCP declarations for one run.

    The Agenta builtin is unlike an external server: it exposes only callback
    tools already resolved for this invocation.  Exchange the invocation token
    for a narrower credential before handing the MCP server to the runner.
    """
    connection = PlatformConnection()
    resolved = await resolve_mcp(
        mcp_servers,
        secret_provider=secret_provider,
        connection=connection,
    )
    configs = parse_mcp_server_configs(mcp_servers)
    if not any(
        isinstance(config.connection, MCPGatewayConnection)
        and config.connection.namespace == "builtin"
        and config.connection.provider == "agenta"
        for config in configs
    ):
        return resolved

    api_base = connection.base_url()
    authorization = connection.authorization()
    if not api_base or not authorization:
        raise ValueError("Agenta MCP requires platform credentials")

    tools = [
        {
            "name": str(spec.name),
            "call_ref": str(spec.call_ref),
            "description": str(spec.description),
            "input_schema": dict(spec.input_schema),
        }
        for spec in tool_specs
        if getattr(spec, "kind", None) == "callback" and getattr(spec, "call_ref", None)
    ]
    async with httpx.AsyncClient(timeout=connection.timeout) as client:
        response = await client.post(
            f"{api_base}/gateways/mcps/credentials/agenta",
            json={"tools": tools},
            headers=connection.headers(authorization=authorization),
        )
    response.raise_for_status()
    credentials = response.json().get("credentials")
    if not isinstance(credentials, str) or not credentials:
        raise ValueError("Agenta MCP credential response was invalid")

    return [
        server.model_copy(
            update={
                "credentials": [
                    ResolvedMCPCredential(
                        binding=HeaderCredentialBinding(name="X-AG-Credentials"),
                        value=credentials,
                    )
                ]
            }
        )
        if server.url.rstrip("/").endswith("/builtin/agenta/run")
        else server
        for server in resolved
    ]
