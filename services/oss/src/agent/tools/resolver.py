"""Composition of SDK tool and MCP resolvers for the agent service."""

from __future__ import annotations

import os
from typing import Any, Sequence

from pydantic import BaseModel, ConfigDict, Field

from agenta.sdk.agents.mcp import (
    MCPResolver,
    ResolvedMCPServer,
    parse_mcp_server_configs,
)
from agenta.sdk.agents.tools import (
    MissingSecretPolicy,
    ResolvedToolSet,
    ToolConfig,
    ToolResolver,
    coerce_tool_configs,
)
from agenta.sdk.utils.constants import TRUTHY

from .gateway import AgentaGatewayToolResolver
from .secrets import VaultToolSecretProvider


class ResolvedAgentResources(BaseModel):
    model_config = ConfigDict(frozen=True)

    tools: ResolvedToolSet = Field(default_factory=ResolvedToolSet)
    mcp_servers: list[ResolvedMCPServer] = Field(default_factory=list)


def _mcp_enabled() -> bool:
    return os.getenv("AGENTA_AGENT_ENABLE_MCP", "").strip().lower() in TRUTHY


async def resolve_agent_resources(
    *,
    tools: Sequence[Any],
    mcp_servers: Sequence[Any],
) -> ResolvedAgentResources:
    tool_configs: list[ToolConfig] = coerce_tool_configs(tools).tool_configs
    secret_provider = VaultToolSecretProvider()
    resolved_tools = await ToolResolver(
        secret_provider=secret_provider,
        gateway_resolver=AgentaGatewayToolResolver(),
        missing_secret_policy=MissingSecretPolicy.ERROR,
    ).resolve(tool_configs)

    resolved_mcp_servers: list[ResolvedMCPServer] = []
    if _mcp_enabled():
        resolved_mcp_servers = await MCPResolver(
            secret_provider=secret_provider,
            missing_secret_policy=MissingSecretPolicy.ERROR,
        ).resolve(parse_mcp_server_configs(mcp_servers))

    return ResolvedAgentResources(
        tools=resolved_tools,
        mcp_servers=resolved_mcp_servers,
    )


async def resolve_tools(tools: Sequence[Any]) -> ResolvedToolSet:
    """Compatibility wrapper for callers resolving tools without MCP."""
    return (
        await resolve_agent_resources(
            tools=tools,
            mcp_servers=[],
        )
    ).tools


async def resolve_mcp_servers(
    mcp_servers: Sequence[Any],
) -> list[dict[str, Any]]:
    """Compatibility wrapper returning the previous wire-dictionary shape."""
    if not _mcp_enabled():
        return []
    resources = await resolve_agent_resources(
        tools=[],
        mcp_servers=mcp_servers,
    )
    return [server.to_wire() for server in resources.mcp_servers]
