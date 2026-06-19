"""Agent-service composition and adapters for tool resolution."""

from .gateway import AgentaGatewayToolResolver, _to_gateway_reference
from .resolver import (
    ResolvedAgentResources,
    resolve_agent_resources,
    resolve_mcp_servers,
    resolve_tools,
)
from .secrets import VaultToolSecretProvider

_gateway_ref = _to_gateway_reference

__all__ = [
    "AgentaGatewayToolResolver",
    "VaultToolSecretProvider",
    "ResolvedAgentResources",
    "resolve_agent_resources",
    "resolve_tools",
    "resolve_mcp_servers",
]
