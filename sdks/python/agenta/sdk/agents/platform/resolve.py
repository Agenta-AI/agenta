"""The three resolution entrypoints, composed over the SDK framework + platform adapters.

Deliberately three separate functions, not one aggregate: a caller resolves only what it
needs. Each defaults to the Agenta-platform-backed adapters (the connected path) but accepts
injected adapters, so an offline standalone user can pass an env-backed secret provider and
no gateway resolver, and a test can pass fakes.

- ``resolve_tools`` -> runnable tool specs (builtin names, code/client specs, gateway callback
  specs). Code-tool named secrets are resolved through the secret provider here.
- ``resolve_mcp`` -> resolved MCP servers (named secrets injected). No deployment flag gate
  here; gating MCP on/off is the caller's concern.
- ``resolve_secrets`` -> the harness/model provider keys (``agenta.sdk.agents.platform``'s
  ``resolve_provider_keys``), optional by design.
"""

from __future__ import annotations

from typing import Any, List, Optional, Sequence

from agenta.sdk.agents.mcp import (
    MCPResolver,
    ResolvedMCPServer,
    parse_mcp_server_configs,
)
from agenta.sdk.agents.tools import (
    MissingSecretPolicy,
    ResolvedToolSet,
    ToolResolver,
    coerce_tool_configs,
)
from agenta.sdk.agents.tools.interfaces import GatewayToolResolver, ToolSecretProvider

from .gateway import AgentaGatewayToolResolver
from .secrets import AgentaNamedSecretProvider
from .secrets import resolve_provider_keys as resolve_secrets

__all__ = ["resolve_tools", "resolve_mcp", "resolve_secrets"]


async def resolve_tools(
    tools: Sequence[Any],
    *,
    secret_provider: Optional[ToolSecretProvider] = None,
    gateway_resolver: Optional[GatewayToolResolver] = None,
    missing_secret_policy: MissingSecretPolicy = MissingSecretPolicy.ERROR,
) -> ResolvedToolSet:
    """Resolve tool declarations into runnable specs. Defaults to the Agenta platform adapters."""
    return await ToolResolver(
        secret_provider=secret_provider or AgentaNamedSecretProvider(),
        gateway_resolver=gateway_resolver or AgentaGatewayToolResolver(),
        missing_secret_policy=missing_secret_policy,
    ).resolve(coerce_tool_configs(tools).tool_configs)


async def resolve_mcp(
    mcp_servers: Sequence[Any],
    *,
    secret_provider: Optional[ToolSecretProvider] = None,
    missing_secret_policy: MissingSecretPolicy = MissingSecretPolicy.ERROR,
) -> List[ResolvedMCPServer]:
    """Resolve MCP server declarations (named secrets injected). Caller decides whether to call."""
    return await MCPResolver(
        secret_provider=secret_provider or AgentaNamedSecretProvider(),
        missing_secret_policy=missing_secret_policy,
    ).resolve(parse_mcp_server_configs(mcp_servers))
