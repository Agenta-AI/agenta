"""The resolution entrypoints, composed over the SDK framework + platform adapters.

Deliberately separate functions, not one aggregate: a caller resolves only what it needs. Each
defaults to the Agenta-platform-backed adapters (the connected path) but accepts injected
adapters, so an offline standalone user can pass an env-backed secret provider and no gateway
resolver, and a test can pass fakes.

- ``resolve_tools`` -> runnable tool specs (builtin names, code/client specs, gateway callback
  specs). Code-tool named secrets are resolved through the secret provider here.
- ``resolve_mcp`` -> resolved MCP servers (named secrets injected). No deployment flag gate
  here; gating MCP on/off is the caller's concern.
- ``resolve_connection`` -> one least-privilege ``ResolvedConnection`` for a single ``ModelRef``,
  via the secrets-backed ``VaultConnectionResolver`` (fail-loud), routed through the gateway
  and carrying no provider secret (D36/D30).
- ``resolve_secrets`` -> deprecated compatibility alias for ``resolve_connection``; it warns on
  use and remains available for callers migrating from the previous public name.
"""

from __future__ import annotations

import warnings
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
    PermissionMode,
    ResolvedToolSet,
    ToolResolver,
    coerce_tool_configs,
)
from agenta.sdk.agents.tools.interfaces import (
    GatewayConnectionResolver,
    GatewayToolResolver,
    PlatformToolResolver,
    ToolSecretProvider,
    WorkflowToolResolver,
)
from agenta.sdk.utils.logging import get_module_logger

from .connection import GatewayCredentialsError, PlatformConnection
from .connections import VaultConnectionResolver
from .gateway import AgentaGatewayToolResolver
from .platform_tools import AgentaPlatformToolResolver
from .secrets import AgentaNamedSecretProvider
from .workflow import AgentaWorkflowToolResolver

__all__ = ["resolve_connection", "resolve_mcp", "resolve_secrets", "resolve_tools"]

log = get_module_logger(__name__)

# The API's code for "this deployment does not serve the MCP gateway"
# (`AGENTA_MCP_GATEWAY_ENABLED`). The one refusal an agent run recovers from rather than
# fails on, because the pre-gateway path — dial the declared server directly — still works.
MCP_GATEWAY_DISABLED_CODE = "mcp_gateway_disabled"


async def resolve_tools(
    tools: Sequence[Any],
    *,
    secret_provider: Optional[ToolSecretProvider] = None,
    gateway_resolver: Optional[GatewayToolResolver] = None,
    gateway_connection_resolver: Optional[GatewayConnectionResolver] = None,
    workflow_resolver: Optional[WorkflowToolResolver] = None,
    platform_resolver: Optional[PlatformToolResolver] = None,
    missing_secret_policy: MissingSecretPolicy = MissingSecretPolicy.ERROR,
    permission_default: PermissionMode = "allow_reads",
) -> ResolvedToolSet:
    """Resolve tool declarations into runnable specs. Defaults to the Agenta platform adapters.

    A ``type:"reference"`` workflow tool resolves through the ``workflow_resolver`` into a
    ``callback`` spec (server-side workflow execute), the same executor a gateway tool uses. A
    ``type:"platform"`` tool resolves through the ``platform_resolver`` into a ``callback`` spec
    carrying a direct ``call`` to the exposed Agenta endpoint.

    ``permission_default`` is the agent-wide mode the gateway permission compiler applies to an
    ``inherit`` value on a ``gateway_connection`` entry. It is ignored by every other arm."""
    default_gateway_resolver = AgentaGatewayToolResolver()
    return await ToolResolver(
        secret_provider=secret_provider or AgentaNamedSecretProvider(),
        gateway_resolver=gateway_resolver or default_gateway_resolver,
        gateway_connection_resolver=(
            gateway_connection_resolver or default_gateway_resolver
        ),
        workflow_resolver=workflow_resolver or AgentaWorkflowToolResolver(),
        platform_resolver=platform_resolver or AgentaPlatformToolResolver(),
        missing_secret_policy=missing_secret_policy,
    ).resolve(
        coerce_tool_configs(tools).tool_configs,
        permission_default=permission_default,
    )


async def resolve_mcp(
    mcp_servers: Sequence[Any],
    *,
    secret_provider: Optional[ToolSecretProvider] = None,
    missing_secret_policy: MissingSecretPolicy = MissingSecretPolicy.ERROR,
    connection: Optional[PlatformConnection] = None,
) -> List[ResolvedMCPServer]:
    """Resolve MCP server declarations. Caller decides whether to call.

    Routes through the gateway (D36/D30/D31) when a backend is configured: every declared
    server becomes a `custom/{name}` gateway route carrying OUR credentials, and no named
    secret is fetched. With no backend configured (the offline/standalone case), or with a
    backend that says it does not serve the MCP gateway, it falls back to the direct dial
    with named secrets injected, unchanged.
    """
    platform_connection = connection or PlatformConnection()
    server_configs = parse_mcp_server_configs(mcp_servers)

    # NOT the platform authorization: this value crosses into the sandbox, so it is
    # exchanged for one the API accepts on the gateway routes and nowhere else. Exchanged
    # only when a server was actually declared — a run with no MCP server has nothing to
    # hand a credential to, and should not pay a round trip to learn that.
    #
    # The exchange names the plane, which makes it the moment the API can say the MCP
    # gateway is switched off. That answer is not a failure: this SDK still knows how to
    # dial a declared server directly, and no credential is exactly how `MCPResolver`
    # chooses that path. Every other refusal stays a failed run, because it means the
    # gateway is meant to serve and would not.
    gateway_credentials_value = None
    if server_configs:
        try:
            gateway_credentials_value = await platform_connection.gateway_authorization(
                plane="mcp"
            )
        except GatewayCredentialsError as exc:
            if exc.failure_code != MCP_GATEWAY_DISABLED_CODE:
                raise
            log.info(
                "agent: the MCP gateway is disabled on this deployment; "
                "dialling declared MCP servers directly"
            )

    return await MCPResolver(
        secret_provider=secret_provider or AgentaNamedSecretProvider(),
        missing_secret_policy=missing_secret_policy,
        gateway_base_url=platform_connection.gateway_base_url(),
        gateway_credentials_value=gateway_credentials_value,
    ).resolve(server_configs)


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


async def resolve_secrets(
    *,
    model: ModelRef,
    context: RuntimeAuthContext,
    resolver: Optional[ConnectionResolver] = None,
) -> ResolvedConnection:
    """Deprecated compatibility alias for :func:`resolve_connection`.

    ``resolve_secrets`` was part of the public platform module before connection resolution
    became the canonical API. Keep the import path available for one deprecation window while
    directing callers to the least-privilege connection resolver.
    """
    warnings.warn(
        "resolve_secrets is deprecated; use resolve_connection instead. It will be removed "
        "in a future breaking release.",
        DeprecationWarning,
        stacklevel=2,
    )
    return await resolve_connection(model=model, context=context, resolver=resolver)
