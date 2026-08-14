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
  ``resolve_provider_keys``), optional by design. Deprecated: the model-blind whole-vault dump,
  superseded by ``resolve_connection`` (one connection, fail-loud); kept until the service
  migrates onto the new resolver.
- ``resolve_connection`` -> one least-privilege ``ResolvedConnection`` for a single ``ModelRef``,
  via the secrets-backed ``VaultConnectionResolver`` (fail-loud).
"""

from __future__ import annotations

from typing import Any, List, Optional, Sequence

from agenta.sdk.agents.connections import (
    ConnectionResolver,
    ModelRef,
    ResolvedConnection,
    RuntimeAuthContext,
)
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
from agenta.sdk.agents.tools.interfaces import (
    GatewayToolResolver,
    PlatformToolResolver,
    ToolSecretProvider,
    WorkflowToolResolver,
)

from .connection import PlatformConnection
from .connections import VaultConnectionResolver
from .gateway import AgentaGatewayToolResolver
from .platform_tools import AgentaPlatformToolResolver
from .secrets import AgentaNamedSecretProvider
from .secrets import resolve_provider_keys as resolve_secrets
from .workflow import AgentaWorkflowToolResolver

__all__ = ["resolve_tools", "resolve_mcp", "resolve_secrets", "resolve_connection"]


async def resolve_tools(
    tools: Sequence[Any],
    *,
    secret_provider: Optional[ToolSecretProvider] = None,
    gateway_resolver: Optional[GatewayToolResolver] = None,
    workflow_resolver: Optional[WorkflowToolResolver] = None,
    platform_resolver: Optional[PlatformToolResolver] = None,
    missing_secret_policy: MissingSecretPolicy = MissingSecretPolicy.ERROR,
) -> ResolvedToolSet:
    """Resolve tool declarations into runnable specs. Defaults to the Agenta platform adapters.

    A ``type:"reference"`` workflow tool resolves through the ``workflow_resolver`` into a
    ``callback`` spec (server-side workflow execute), the same executor a gateway tool uses. A
    ``type:"platform"`` tool resolves through the ``platform_resolver`` into a ``callback`` spec
    carrying a direct ``call`` to the exposed Agenta endpoint."""
    return await ToolResolver(
        secret_provider=secret_provider or AgentaNamedSecretProvider(),
        gateway_resolver=gateway_resolver or AgentaGatewayToolResolver(),
        workflow_resolver=workflow_resolver or AgentaWorkflowToolResolver(),
        platform_resolver=platform_resolver or AgentaPlatformToolResolver(),
        missing_secret_policy=missing_secret_policy,
    ).resolve(coerce_tool_configs(tools).tool_configs)


async def resolve_mcp(
    mcp_servers: Sequence[Any],
    *,
    secret_provider: Optional[ToolSecretProvider] = None,
    missing_secret_policy: MissingSecretPolicy = MissingSecretPolicy.ERROR,
    connection: Optional[PlatformConnection] = None,
) -> List[ResolvedMCPServer]:
    """Resolve MCP server declarations. Caller decides whether to call.

    Routes through the gateway (W1/D30/D31) when a backend is configured: every declared
    server becomes a `custom/{name}` gateway route carrying OUR credentials, and no named
    secret is fetched. With no backend configured (the offline/standalone case) it falls
    back to the direct dial with named secrets injected, unchanged.
    """
    platform_connection = connection or PlatformConnection()
    return await MCPResolver(
        secret_provider=secret_provider or AgentaNamedSecretProvider(),
        missing_secret_policy=missing_secret_policy,
        gateway_base_url=platform_connection.gateway_base_url(),
        gateway_credentials_value=platform_connection.authorization(),
    ).resolve(parse_mcp_server_configs(mcp_servers))


async def resolve_connection(
    *,
    model: ModelRef,
    context: RuntimeAuthContext,
    resolver: Optional[ConnectionResolver] = None,
) -> ResolvedConnection:
    """Resolve one ``ModelRef`` into one least-privilege ``ResolvedConnection``. Fail-loud.

    Defaults to the secrets-backed :class:`VaultConnectionResolver` (the connected path); pass an
    offline resolver (``EnvConnectionResolver`` / ``StaticConnectionResolver``) or a fake for a
    standalone or test run.
    """
    return await (resolver or VaultConnectionResolver()).resolve(
        model=model, context=context
    )
