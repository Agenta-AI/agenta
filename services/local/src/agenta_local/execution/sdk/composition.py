"""Offline composition for the SDK agent handler: static connection, no platform resolvers."""

from agenta.sdk.agents.adapters.sandbox_agent import SandboxAgentBackend
from agenta.sdk.agents.connections.resolver import StaticConnectionResolver
from agenta.sdk.agents.handler import AgentComposition
from agenta.sdk.agents.mcp import ResolvedMCPServer
from agenta.sdk.agents.tools.models import ResolvedToolSet

from ...core.execution.dtos import ExecutionCredential


async def empty_tools_resolver(*tool_configs) -> ResolvedToolSet:
    return ResolvedToolSet()


async def empty_mcp_resolver(*mcp_server_configs) -> list[ResolvedMCPServer]:
    return []


def build_composition(
    *, runner_url: str, credential: ExecutionCredential
) -> tuple[AgentComposition, StaticConnectionResolver]:
    resolver = StaticConnectionResolver(
        provider=credential.provider,
        api_key=credential.api_key,
        base_url=credential.base_url,
    )
    composition = AgentComposition(
        resolve_tools=empty_tools_resolver,
        resolve_mcp_servers=empty_mcp_resolver,
        resolve_connection=resolver.resolve,
        select_backend=lambda template: SandboxAgentBackend(
            sandbox="local", url=runner_url
        ),
    )
    return composition, resolver
