"""Manage MCP endpoints and transparently proxy MCP requests."""

import json
import re
from dataclasses import dataclass
from time import monotonic
from typing import TYPE_CHECKING, Any, Dict, List, Optional
from urllib.parse import urlparse
from uuid import UUID, uuid4

from oss.src.core.access.permissions.types import Permission
from oss.src.core.gateway.connections.dtos import Connection
from oss.src.core.gateway.connections.service import ConnectionsService
from oss.src.core.gateways.mcps.dtos import MCPAuthScheme
from oss.src.core.gateways.dtos import (
    GatewayConnectAffordance,
    GatewayConnectionRequirement,
    GatewayConnectionState,
    GatewayEndpointNamespace,
)
from oss.src.core.gateways.mcps.dtos import (
    AGENTA_PROVIDER,
    COMPOSIO_PROVIDER,
    MOCK_PROVIDER,
    MCPBrokeredAuth,
    MCPCallContext,
    MCPDirectAuth,
    MCPEndpoint,
    MCPEndpointCreate,
    MCPEndpointData,
    MCPEndpointRoute,
    MCPEndpointEdit,
    MCPOAuthData,
    MCPEndpointQuery,
    MCPRelayAuth,
    MCPResolvedRoute,
    MCPToolFilter,
)
from oss.src.core.gateways.mcps.interfaces import (
    MCPEndpointsDAOInterface,
    MCPRelayResult,
)
from oss.src.core.gateways.mcps.oauth.interfaces import MCPOAuthRefresherInterface
from oss.src.core.gateways.mcps.oauth.storage import grant_settings_expired
from oss.src.core.gateways.mcps.oauth.types import MCPOAuthRefreshFailedError
from oss.src.core.gateways.mcps.registry import MCPUpstreamRegistry
from oss.src.core.gateways.run_claims import gateway_run_id
from oss.src.core.gateways.types import GatewayEndpointInactiveError
from oss.src.core.gateways.mcps.types import (
    MCPAuthRequiredError,
    MCPConnectionNameTakenError,
    MCPEndpointNotFoundError,
    MCPScopeInsufficientError,
    MCPToolNotAllowedError,
    MCPUpstreamError,
)
from oss.src.core.gateways.policy.dtos import (
    BoundSecretRef,
    ProviderKeyRef,
    ResolvedSecret,
    SecretOwnerKind,
    SecretMode,
    GatewayOutcome,
    GatewayPlane,
    GatewayTarget,
)
from oss.src.core.gateways.policy.interfaces import SecretsResolverInterface
from oss.src.core.gateways.policy.service import GatewayPolicyService
from oss.src.core.gateways.policy.types import (
    PolicyDeniedError,
    SecretInvalidError,
    SecretNotFoundError,
)
from oss.src.core.shared.dtos import Windowing
from oss.src.utils.context import AuthScope
from oss.src.utils.env import env
from oss.src.utils.helpers import get_slug_from_name_and_id

# Built-in endpoints select adapters by provider segment.
if TYPE_CHECKING:
    from fastapi import Request


_BUILTIN_ADAPTER_KEYS: Dict[str, str] = {
    AGENTA_PROVIDER: "agenta",
    MOCK_PROVIDER: "mock",
}


def _adapter_key(
    *, namespace: GatewayEndpointNamespace, provider: Optional[str]
) -> str:
    if namespace == GatewayEndpointNamespace.BUILTIN:
        if provider == COMPOSIO_PROVIDER:
            return "composio"
        key = _BUILTIN_ADAPTER_KEYS.get(provider or "")
        if key is None:
            raise MCPEndpointNotFoundError(namespace=namespace, name=provider or "")
        return key
    if namespace == GatewayEndpointNamespace.CUSTOM:
        return "http"
    if namespace == GatewayEndpointNamespace.STANDARD:
        if provider == MOCK_PROVIDER:
            return "mock"
        if provider == COMPOSIO_PROVIDER:
            return "composio_standard"
    raise MCPEndpointNotFoundError(namespace=namespace, name=provider or "")


@dataclass
class _ResolvedTarget:
    """Service-internal only (§8: "never crosses a layer... not a DTO in §4").
    `endpoint` is always populated (generated or a row) so allowlist/auth/route
    logic reads it uniformly; `connection` is set only for `builtin`, carrying the
    raw row `MCPBrokeredAuth` wraps."""

    namespace: GatewayEndpointNamespace
    name: str
    endpoint: MCPEndpoint
    provider: Optional[str] = None
    integration: Optional[str] = None
    connection: Optional[Connection] = None


_INSUFFICIENT_SCOPE_RE = re.compile(
    r"""\berror\s*=\s*"insufficient_scope"|\berror\s*=\s*insufficient_scope\b"""
)
_SCOPE_PARAM_RE = re.compile(r'\bscope\s*=\s*"([^"]*)"')


def _parse_scope_challenge(headers: Dict[str, str]) -> Optional[List[str]]:
    """Extract scopes from an RFC 6750 insufficient-scope challenge."""
    header = next(
        (v for k, v in headers.items() if k.lower() == "www-authenticate"), None
    )
    if not header or not _INSUFFICIENT_SCOPE_RE.search(header):
        return None
    match = _SCOPE_PARAM_RE.search(header)
    return match.group(1).split() if match else []


def _elapsed_ms(started: float) -> int:
    """Milliseconds since `started`, on the monotonic clock.

    Monotonic rather than wall clock: a duration read off the system clock can come out
    negative, or minutes long, when the clock is stepped mid-call.
    """
    return max(0, round((monotonic() - started) * 1000))


def _presented_access_token(auth: MCPRelayAuth) -> Optional[str]:
    """The OAuth access token a relay actually sent, if it sent one."""
    secret = getattr(auth, "secret", None)
    data = getattr(secret, "secret", None)
    grant = getattr(getattr(data, "data", None), "grant", None)
    return getattr(grant, "access_token", None)


def _target_path(
    *,
    namespace: GatewayEndpointNamespace,
    provider: Optional[str],
    integration: Optional[str],
    name: str,
) -> str:
    return "/".join(s for s in (namespace.value, provider, integration, name) if s)


# Last resort when a connection is created with neither a name nor a parseable URL host.
# Never reached from the API, whose create route requires a valid URL before the service
# sees it, but a slug is NOT NULL and nothing is served by failing over a label.
_FALLBACK_SLUG_BASE = "mcp-connection"


def derive_endpoint_slug(endpoint: MCPEndpointCreate) -> str:
    """The stable identity for a new connection, derived once at creation.

    Callers do not choose it. A connection's slug is its identity: agent configuration
    references it, the data-plane route is built from it, and its grant is addressed by
    the id beside it, so it has to survive every later edit to the display name. Asking a
    person to invent one at setup put identity in the same field as a label and invited
    them to change it later.

    The display name seeds it, falling back to the server's hostname, which is what the
    connection flow shows when a server offers no usable name. The seed is readability
    and nothing else: uniqueness comes from a `uuid4` suffix, matching how secrets,
    testsets and evaluators derive theirs.

    Not from the name, for two reasons. A name is free again the moment its connection is
    deleted, and a slug must never be reused for a different connection, because agent
    configurations and grant rows are addressed by the identity it stands for. And a slug
    computed from the name would track the name, which is the coupling this exists to
    remove.
    """
    seed = (endpoint.name or "").strip()
    if not seed:
        seed = urlparse(endpoint.data.route.base_url or "").hostname or ""
    return get_slug_from_name_and_id(seed or _FALLBACK_SLUG_BASE, uuid4())


# The runner's own normalization (`piMcpToolName` in
# services/runner/src/extensions/pi-mcp.ts), because the string this produces is what a
# harness puts in front of the model. Two display names that normalize to one prefix are
# one name as far as a tool call is concerned, so that is the comparison a uniqueness
# check has to make.
#
# One deliberate difference: this strips surrounding whitespace first and the runner does
# not, so "  Acme  " is compared here as "Acme" and rendered by the runner as "__Acme__".
# The effect is to refuse a pair the harness would in fact keep apart, never to admit a
# pair it would collide, so the mismatch can only over-refuse. Converging the two would
# change which names a project may hold and belongs with the decision about keying policy
# on the connection slug rather than the display name.
_TOOL_PREFIX_UNSAFE = re.compile(r"[^A-Za-z0-9_]")


def tool_prefix(display_name: Optional[str]) -> str:
    """The token a harness renders as `mcp__<this>__<tool>` for a connection."""
    return _TOOL_PREFIX_UNSAFE.sub("_", (display_name or "").strip())


class MCPGatewayService:
    def __init__(
        self,
        *,
        mcp_endpoints_dao: MCPEndpointsDAOInterface,
        policy: GatewayPolicyService,
        resolver: SecretsResolverInterface,
        upstream_registry: MCPUpstreamRegistry,
        connections_service: ConnectionsService,
        agenta_tools_router: Optional[Any] = None,
        oauth_refresher: Optional[MCPOAuthRefresherInterface] = None,
    ) -> None:
        self.mcp_endpoints_dao = mcp_endpoints_dao
        self.policy = policy
        self.resolver = resolver
        self.upstream_registry = upstream_registry
        self.connections_service = connections_service
        self.agenta_tools_router = agenta_tools_router
        # Absent only in tests that never resolve an OAuth endpoint; a deployment wires
        # the connect service, which is what knows how to spend a refresh token.
        self.oauth_refresher = oauth_refresher

    # Management

    async def create_endpoint(
        self,
        *,
        project_id: UUID,
        user_id: UUID,
        #
        endpoint: MCPEndpointCreate,
    ) -> Optional[MCPEndpoint]:
        if not endpoint.slug:
            endpoint = endpoint.model_copy(
                update={"slug": derive_endpoint_slug(endpoint)}
            )
        await self._check_name_is_free(project_id=project_id, name=endpoint.name)
        return await self.mcp_endpoints_dao.create_endpoint(
            project_id=project_id,
            user_id=user_id,
            #
            endpoint=endpoint,
        )

    async def _check_name_is_free(
        self,
        *,
        project_id: UUID,
        name: Optional[str],
        excluding: Optional[UUID] = None,
    ) -> None:
        """Refuse a display name another connection in this project already answers to.

        Not cosmetic. A harness renders a connection's tools as `mcp__<name>__<tool>` and
        the model chooses a tool by that string, so two connections sharing a name give
        the model no way to say which account it means. The runner refuses the whole
        registration on the collision, which takes down both connections rather than the
        second one.

        Compared on the rendered prefix rather than the raw string, because the
        rendering maps everything outside `[A-Za-z0-9_]` to an underscore and an exact
        comparison would let "Acme Notion" and "Acme-Notion" through.

        An unnamed connection is not checked: it renders no prefix worth colliding, and
        nothing has ever required a name here.
        """
        prefix = tool_prefix(name)
        if not prefix:
            return
        # A project-wide read, and the only way to ask this question today: the compared
        # value is the rendered prefix, which is derived rather than stored, so no filter
        # can be pushed into the query. It is also a check-then-act with no constraint
        # behind it, so two concurrent creates with one name both succeed. Both close
        # together by storing the prefix as a column with a partial unique index on
        # `(project_id, tool_prefix)`, which is a migration rather than a change here
        # (D12). Until then the scan is skipped wherever the answer cannot have changed.
        existing = await self.mcp_endpoints_dao.query_endpoints(project_id=project_id)
        for other in existing:
            if excluding is not None and other.id == excluding:
                continue
            if tool_prefix(other.name) == prefix:
                raise MCPConnectionNameTakenError(
                    name=name or "", conflicting_slug=other.slug or str(other.id)
                )

    async def fetch_endpoint(
        self,
        *,
        project_id: UUID,
        #
        endpoint_id: UUID,
    ) -> Optional[MCPEndpoint]:
        return await self.mcp_endpoints_dao.fetch_endpoint(
            project_id=project_id,
            #
            endpoint_id=endpoint_id,
        )

    async def bind_endpoint_secret(
        self,
        *,
        project_id: UUID,
        user_id: UUID,
        #
        endpoint_id: UUID,
        secret_id: Optional[UUID],
    ) -> Optional[MCPEndpoint]:
        """Bind a connection to its stored authorization, or clear it. See the DAO."""
        return await self.mcp_endpoints_dao.bind_endpoint_secret(
            project_id=project_id,
            user_id=user_id,
            #
            endpoint_id=endpoint_id,
            secret_id=secret_id,
        )

    async def cache_endpoint_discovery(
        self,
        *,
        project_id: UUID,
        user_id: UUID,
        #
        endpoint_id: UUID,
        oauth: MCPOAuthData,
    ) -> Optional[MCPEndpoint]:
        """Record what discovery learned. See the DAO."""
        return await self.mcp_endpoints_dao.cache_endpoint_discovery(
            project_id=project_id,
            user_id=user_id,
            #
            endpoint_id=endpoint_id,
            oauth=oauth,
        )

    async def edit_endpoint(
        self,
        *,
        project_id: UUID,
        user_id: UUID,
        #
        endpoint: MCPEndpointEdit,
    ) -> Optional[MCPEndpoint]:
        # Only when the rendered prefix actually moves, and excluding itself, so
        # re-saving a connection is never a collision with the name it already has. An edit that changes a URL, a
        # tool filter or a description asked this question on every save and read every
        # connection in the project to answer it, and the answer could not have changed
        # (D12). One indexed read replaces that scan.
        current = await self.mcp_endpoints_dao.fetch_endpoint(
            project_id=project_id, endpoint_id=endpoint.id
        )
        if current is None or tool_prefix(current.name) != tool_prefix(endpoint.name):
            await self._check_name_is_free(
                project_id=project_id, name=endpoint.name, excluding=endpoint.id
            )
        return await self.mcp_endpoints_dao.edit_endpoint(
            project_id=project_id,
            user_id=user_id,
            #
            endpoint=endpoint,
        )

    async def delete_endpoint(
        self,
        *,
        project_id: UUID,
        #
        endpoint_id: UUID,
    ) -> bool:
        return await self.mcp_endpoints_dao.delete_endpoint(
            project_id=project_id,
            #
            endpoint_id=endpoint_id,
        )

    async def query_endpoints(
        self,
        *,
        project_id: UUID,
        #
        endpoint: Optional[MCPEndpointQuery] = None,
        #
        windowing: Optional[Windowing] = None,
    ) -> List[MCPEndpoint]:
        return await self.mcp_endpoints_dao.query_endpoints(
            project_id=project_id,
            #
            endpoint=endpoint,
            #
            windowing=windowing,
        )

    # Endpoint listing

    async def list_endpoints(self, *, scope: AuthScope) -> List[MCPEndpoint]:
        """Takes the scope rather than a bare project_id (R14). §8 derives
        GatewayConnectionState "per owner and per namespace", which a project_id alone
        cannot express; `_connection_state` is the seam that wiring lands on."""
        project_id = scope.project_id
        custom = await self.mcp_endpoints_dao.query_endpoints(project_id=project_id)

        # Include inactive connections so their endpoint can report its connection state.
        connections = await self.connections_service.query_connections(
            project_id=project_id,
            provider_key="composio",
            is_active=None,
        )
        builtin = [self._builtin_endpoint(connection) for connection in connections]

        provider_keys = await self.resolver.available_provider_keys(scope=scope)
        standard = []
        if self._mocks_enabled() and MOCK_PROVIDER in provider_keys:
            standard.append(self._standard_mock_endpoint())
        if COMPOSIO_PROVIDER in provider_keys:
            standard.append(self._standard_composio_endpoint())

        # Return built-in, standard, then custom endpoints.
        return [
            *self._agenta_endpoints(),
            *builtin,
            *self._mock_endpoints(),
            *standard,
            *custom,
        ]

    @staticmethod
    def _mocks_enabled() -> bool:
        return env.mock_gateways.enabled

    def _agenta_endpoints(self) -> List[MCPEndpoint]:
        """Return Agenta-provided built-in MCP endpoints."""
        return [
            MCPEndpoint(
                slug="run",
                name="Agenta Tools",
                auth_mode=MCPAuthScheme.NONE,
                namespace=GatewayEndpointNamespace.BUILTIN,
                provider_key=AGENTA_PROVIDER,
                data=MCPEndpointData(route=MCPEndpointRoute()),
            )
        ]

    def _mock_endpoints(self) -> List[MCPEndpoint]:
        if not self._mocks_enabled():
            return []
        return [
            MCPEndpoint(
                slug="mock",
                name="Mock Tools",
                auth_mode=MCPAuthScheme.NONE,
                namespace=GatewayEndpointNamespace.BUILTIN,
                provider_key=MOCK_PROVIDER,
                data=MCPEndpointData(route=MCPEndpointRoute()),
            )
        ]

    def _standard_mock_endpoint(self) -> MCPEndpoint:
        return MCPEndpoint(
            slug=MOCK_PROVIDER,
            name="Mock MCP",
            auth_mode=MCPAuthScheme.API_KEY,
            namespace=GatewayEndpointNamespace.STANDARD,
            provider_key=MOCK_PROVIDER,
            data=MCPEndpointData(route=MCPEndpointRoute()),
        )

    def _standard_composio_endpoint(self) -> MCPEndpoint:
        return MCPEndpoint(
            slug=COMPOSIO_PROVIDER,
            name="Composio",
            auth_mode=MCPAuthScheme.API_KEY,
            namespace=GatewayEndpointNamespace.STANDARD,
            provider_key=COMPOSIO_PROVIDER,
            data=MCPEndpointData(route=MCPEndpointRoute()),
        )

    @staticmethod
    def _brokered_tools(connection: Connection) -> MCPToolFilter:
        """The tools a brokered connection grants, deny-by-default (OR58).

        A brokered endpoint spends a credential Agenta holds on the tenant's behalf, so
        the filter is built explicitly instead of taking `MCPToolFilter()`'s default,
        whose `allowlist=None` `GatewayEndpointFilter.allows` reads as allow-all. Any
        member with `USE_MCP_ENDPOINTS` could otherwise call every tool on the connection.

        The grant is the connection row's own `data.tools`, the place the connect flow
        records what was approved for it. A connection that names none grants none: the
        empty allowlist refuses every tool, and `_filter_tool_list` lists none, because on
        this namespace an unstated grant is not the same as an unlimited one.

        The default itself is left alone. `GatewayEndpointFilter.allows` is shared with
        the LLM plane, where `models` with no allowlist means a built-in endpoint serving
        Agenta's whole catalogue, and with every stored custom MCP endpoint, which is
        registered with no tool filter and would go dark. Those are the field's other
        readers: `MCPGatewayService._check_allowlist`, `_filter_tool_list`,
        `LLMGatewayService._check_allowlist` and `GatewayEndpointFilter.enumerate`, which
        backs `GET /v1/models`.
        """
        data = connection.data if isinstance(connection.data, dict) else {}
        granted = data.get("tools")
        return MCPToolFilter(
            allowlist=(
                [tool for tool in granted if isinstance(tool, str) and tool]
                if isinstance(granted, list)
                else []
            )
        )

    def _builtin_endpoint(self, connection: Connection) -> MCPEndpoint:
        """Build one generated MCP endpoint for a Composio connection."""
        return MCPEndpoint(
            slug=connection.slug,
            name=connection.name,
            namespace=GatewayEndpointNamespace.BUILTIN,
            connection_id=connection.id,
            provider_key=connection.provider_key.value,
            integration_key=connection.integration_key,
            auth_mode=(
                MCPAuthScheme.NONE if not connection.has_auth else MCPAuthScheme.OAUTH
            ),
            data=MCPEndpointData(
                route=MCPEndpointRoute(
                    base_url=_builtin_placeholder_url(
                        provider=connection.provider_key.value,
                        integration=connection.integration_key,
                        slug=connection.slug,
                    )
                ),
                tools=self._brokered_tools(connection),
            ),
        )

    # Connection state

    async def _connection_state(
        self,
        *,
        project_id: UUID,
        user_id: Optional[UUID],
        #
        endpoint: MCPEndpoint,
    ) -> GatewayConnectionState:
        """Derive an endpoint's connection state for an owner."""
        if endpoint.auth_mode == MCPAuthScheme.NONE:
            return GatewayConnectionState.READY

        if endpoint.namespace == GatewayEndpointNamespace.CUSTOM:
            if endpoint.secret_id is not None and endpoint.flags.is_valid:
                return GatewayConnectionState.READY
            return GatewayConnectionState.NEEDS_AUTH

        if endpoint.connection_id is not None:
            connection = await self.connections_service.get_connection(
                project_id=project_id,
                connection_id=endpoint.connection_id,
            )
            if connection is not None and connection.is_active and connection.is_valid:
                return GatewayConnectionState.READY
            return GatewayConnectionState.NEEDS_AUTH

        # API-key endpoints require user input when no usable secret is available.
        return GatewayConnectionState.NEEDS_AUTH

    # Data plane

    async def relay(
        self,
        *,
        scope: AuthScope,
        namespace: GatewayEndpointNamespace,
        name: str,
        provider: Optional[str] = None,
        integration: Optional[str] = None,
        #
        context: MCPCallContext,
        body: bytes,
        headers: Dict[str, str],
        request: Optional["Request"] = None,
    ) -> MCPRelayResult:
        """Relay an MCP request through policy and the selected upstream adapter."""

        # `_ResolvedTarget` is a plain dataclass, not a pydantic model, so a caller
        # passing the namespace as a bare string (the FastAPI path-param case, or a
        # test) is not auto-coerced the way GatewayTarget's own field would be —
        # every downstream `.value` access (MCPEndpointNotFoundError, _adapter_key)
        # needs a real enum member.
        namespace = GatewayEndpointNamespace(namespace)

        started = monotonic()
        run_id = gateway_run_id(request)

        # 1. Resolve target.
        target = await self._resolve_target(
            project_id=scope.project_id,
            namespace=namespace,
            name=name,
            provider=provider,
            integration=integration,
        )

        self._check_active(target)

        # 2. Allowlist before secret — a refused tool must not cost a vault read.
        self._check_allowlist(target, context)

        policy_target = GatewayTarget(
            plane=GatewayPlane.MCP,
            namespace=namespace,
            name=name,
            provider=provider,
            integration=integration,
            endpoint_id=target.endpoint.id,
            method=context.method,
            tool=context.target,
        )

        # 3. Authorize. The denial is recorded before the exception leaves.
        decision = await self.policy.authorize(
            scope=scope,
            permission=Permission.USE_MCP_ENDPOINTS,
            target=policy_target,
        )

        async def record(outcome: GatewayOutcome) -> None:
            """Record one ending of this relay.

            Every `policy.record` below goes through here, so the two things a call site
            cannot know on its own — how long the call took, and which run it belongs
            to — are stamped in one place rather than five, and an ending added later
            cannot quietly omit them.
            """
            await self.policy.record(
                scope=scope,
                target=policy_target,
                decision=decision,
                outcome=outcome.model_copy(
                    update={"duration_ms": _elapsed_ms(started)}
                ),
                run_id=run_id,
            )

        if not decision.allowed:
            await record(GatewayOutcome(status_code=403))
            raise PolicyDeniedError(
                permission=Permission.USE_MCP_ENDPOINTS,
                target=_target_path(
                    namespace=namespace,
                    provider=provider,
                    integration=integration,
                    name=name,
                ),
            )

        # The builtin Agenta bridge never dials an upstream.  It exposes only
        # the callback tools carried in the invocation-scoped credential and
        # reuses the normal ToolsRouter permission/approval dispatch.
        if provider == AGENTA_PROVIDER:
            if self.agenta_tools_router is None or request is None:
                raise MCPEndpointNotFoundError(namespace=namespace, name=name)
            from oss.src.core.gateways.mcps.providers.agenta.adapter import (
                AgentaMCPAdapter,
            )

            result = await AgentaMCPAdapter(
                tools_router=self.agenta_tools_router
            ).relay(request=request, body=body)
            await record(
                self._outcome_for(result=result, auth=MCPDirectAuth(secret=None))
            )
            return result

        # Resolve the endpoint credentials.
        auth = await self._resolve_auth(scope=scope, target=target)

        # 5. Dispatch. Usage is recorded even on failure.
        route = self._route_for(target=target, project_id=scope.project_id)
        adapter_key = _adapter_key(namespace=namespace, provider=provider)
        # A stored custom endpoint can deliberately target the development mock.
        # Keep it on the real socket adapter so its credential/profile assertion is
        # exercised, while all other custom URLs retain the normal SSRF-protected path.
        if (
            namespace == GatewayEndpointNamespace.CUSTOM
            and self._mocks_enabled()
            and route.url.rstrip("/") == env.mock_gateways.mcp_url.rstrip("/")
        ):
            adapter_key = "mock_http"
        try:
            result = await self.upstream_registry.get(adapter_key).relay(
                route=route,
                auth=auth,
                context=context,
                body=body,
                headers=headers,
            )
        except MCPUpstreamError as exc:
            await record(GatewayOutcome(status_code=exc.status_code))
            raise

        # A refused credential is a reconnect, not a relayed 401.
        #
        # `_renewed` above only renews a grant this deployment can see has expired. It
        # cannot see a grant the provider retired early — someone removing the
        # application at the provider, an administrator revoking the account's
        # authorization, a server that expires a token sooner than it said it would. In
        # every one of those the stored grant looks live, the relay sends it, and the
        # upstream answers 401.
        #
        # That 401 used to travel back to the caller as the upstream's own response, so
        # the connection went on reporting itself connected, the settings screen showed
        # nothing wrong, and an agent saw an authentication error from a server it had
        # no way to re-authorize. There is nothing the caller can retry: the credential
        # is dead and only its owner can replace it. So the connection is marked invalid
        # — which is what `_connection_state` reads — and the caller is handed the same
        # reconnect affordance a never-connected connection gets.
        #
        # Scoped to a stored OAuth connection: a 401 from an unauthenticated or
        # API-key connection is that server's own answer about that server's own
        # credential, and neither has a consent flow to send anyone back through.
        if (
            namespace == GatewayEndpointNamespace.CUSTOM
            and target.endpoint.auth_mode == MCPAuthScheme.OAUTH
            and result.status_code == 401
        ):
            await record(GatewayOutcome(status_code=401))
            await self._invalidate_endpoint(
                scope=scope,
                endpoint=target.endpoint,
                presented_access_token=_presented_access_token(auth),
            )
            raise self._reconnect_required(
                endpoint=target.endpoint,
                path=_target_path(
                    namespace=namespace,
                    provider=provider,
                    integration=integration,
                    name=name,
                ),
            )

        # Convert OAuth insufficient-scope challenges into a reconnect interaction.
        if (
            namespace == GatewayEndpointNamespace.CUSTOM
            and target.endpoint.auth_mode == MCPAuthScheme.OAUTH
            and result.status_code == 403
        ):
            challenged_scopes = _parse_scope_challenge(result.headers)
            if challenged_scopes is not None:
                await record(GatewayOutcome(status_code=403))
                raise MCPScopeInsufficientError(
                    target=_target_path(
                        namespace=namespace,
                        provider=provider,
                        integration=integration,
                        name=name,
                    ),
                    scopes=challenged_scopes,
                    endpoint_id=target.endpoint.id,
                )

        # Record the relay and filter tool listings when configured.
        await record(self._outcome_for(result=result, auth=auth))

        if context.method == "tools/list":
            result = _filter_tool_list(result=result, tools=target.endpoint.data.tools)

        return result

    # Relay helpers

    async def _resolve_target(
        self,
        *,
        project_id: UUID,
        namespace: GatewayEndpointNamespace,
        name: str,
        provider: Optional[str],
        integration: Optional[str],
    ) -> _ResolvedTarget:
        if (
            namespace == GatewayEndpointNamespace.BUILTIN
            and provider == AGENTA_PROVIDER
        ):
            endpoint = next(
                (e for e in self._agenta_endpoints() if e.slug == name), None
            )
            if endpoint is None:
                raise MCPEndpointNotFoundError(namespace=namespace, name=name)
            return _ResolvedTarget(
                namespace=namespace, name=name, provider=provider, endpoint=endpoint
            )

        if namespace == GatewayEndpointNamespace.BUILTIN and provider == MOCK_PROVIDER:
            endpoint = next((e for e in self._mock_endpoints() if e.slug == name), None)
            if endpoint is None:
                raise MCPEndpointNotFoundError(namespace=namespace, name=name)
            return _ResolvedTarget(
                namespace=namespace, name=name, provider=provider, endpoint=endpoint
            )

        if (
            namespace == GatewayEndpointNamespace.STANDARD
            and name == MOCK_PROVIDER
            and self._mocks_enabled()
        ):
            return _ResolvedTarget(
                namespace=namespace, name=name, endpoint=self._standard_mock_endpoint()
            )

        if namespace == GatewayEndpointNamespace.STANDARD and name == COMPOSIO_PROVIDER:
            return _ResolvedTarget(
                namespace=namespace,
                name=name,
                endpoint=self._standard_composio_endpoint(),
            )

        if namespace == GatewayEndpointNamespace.BUILTIN:
            connections = await self.connections_service.query_connections(
                project_id=project_id,
                provider_key=provider,
                integration_key=integration,
                is_active=None,
            )
            connection = next((c for c in connections if c.slug == name), None)
            if connection is None:
                raise MCPEndpointNotFoundError(
                    namespace=namespace,
                    provider=provider,
                    integration=integration,
                    name=name,
                )
            return _ResolvedTarget(
                namespace=namespace,
                name=name,
                provider=provider,
                integration=integration,
                endpoint=self._builtin_endpoint(connection),
                connection=connection,
            )

        # CUSTOM
        endpoint = await self.mcp_endpoints_dao.fetch_endpoint_by_slug(
            project_id=project_id, slug=name
        )
        if endpoint is None:
            raise MCPEndpointNotFoundError(namespace=namespace, name=name)
        return _ResolvedTarget(namespace=namespace, name=name, endpoint=endpoint)

    @staticmethod
    def _check_active(target: _ResolvedTarget) -> None:
        if not target.endpoint.flags.is_active:
            raise GatewayEndpointInactiveError(
                target=_target_path(
                    namespace=target.namespace,
                    provider=target.provider,
                    integration=target.integration,
                    name=target.name,
                )
            )

    def _check_allowlist(
        self, target: _ResolvedTarget, context: MCPCallContext
    ) -> None:
        tool = context.target
        if tool is None:
            return

        if not target.endpoint.data.tools.allows(tool):
            raise MCPToolNotAllowedError(
                tool=tool,
                namespace=target.namespace,
                name=target.name,
                provider=target.provider,
                integration=target.integration,
            )

    async def _resolve_auth(
        self, *, scope: AuthScope, target: _ResolvedTarget
    ) -> MCPRelayAuth:
        if (
            target.namespace == GatewayEndpointNamespace.BUILTIN
            and target.provider == COMPOSIO_PROVIDER
        ):
            # the broker's secret never enters our vault
            # (§4.4) — never routed through the resolver.
            connection = target.connection
            if connection is None or not (connection.is_active and connection.is_valid):
                # §1: secret death refuses the call, it never hides the configuration.
                raise SecretInvalidError(
                    target=_target_path(
                        namespace=target.namespace,
                        provider=target.provider,
                        integration=target.integration,
                        name=target.name,
                    )
                )
            return MCPBrokeredAuth(connection=connection)

        endpoint = target.endpoint
        if target.namespace == GatewayEndpointNamespace.STANDARD:
            secret = await self.resolver.resolve(
                scope=scope,
                ref=ProviderKeyRef(provider_key=target.name),
                mode=SecretMode.PROJECT_ONLY,
            )
            return MCPDirectAuth(secret=secret)
        if endpoint.auth_mode == MCPAuthScheme.NONE:
            return MCPDirectAuth(secret=None)

        if endpoint.auth_mode == MCPAuthScheme.OAUTH:
            # An OAuth connection with no grant is one consent away from working, so the
            # refusal has to say so and carry the action that does it.
            #
            # This used to raise `SecretNotFoundError`, which the proxy renders as
            # `secret_missing` with no affordance at all: a true statement and a dead end.
            # Every OAuth connection is in this state before its first consent and again
            # after a disconnect, so the ordinary way to reach it was to press Disconnect
            # and then run the agent. `_renewed` below already raises the reconnect when a
            # renewal fails, and its own docstring calls that "the same reconnect
            # affordance a never-connected endpoint gets" — which is what a
            # never-connected endpoint did not get.
            #
            # A missing grant is not a dead credential, so the connection is left valid
            # rather than marked invalid. `_connection_state` reads a missing handle as
            # needing authorization on its own, which is the same reading the router uses
            # when a disconnect clears one.
            path = _target_path(
                namespace=target.namespace,
                provider=target.provider,
                integration=target.integration,
                name=target.name,
            )
            if endpoint.secret_id is None:
                raise self._reconnect_required(endpoint=endpoint, path=path)
            try:
                secret = await self.resolver.resolve(
                    scope=scope,
                    ref=BoundSecretRef(secret_id=endpoint.secret_id),
                    # one consent per server (out-of-scope.md)
                    mode=SecretMode.PROJECT_ONLY,
                )
            except SecretNotFoundError as e:
                # The row names a grant the vault no longer holds. Reachable only if a
                # grant was removed without its connection being disconnected, but the
                # caller's position is identical to having never connected, so the answer
                # is too.
                raise self._reconnect_required(endpoint=endpoint, path=path) from e
            secret = await self._renewed(
                scope=scope, target=target, endpoint=endpoint, secret=secret
            )
            return MCPDirectAuth(secret=secret)

        if endpoint.auth_mode == MCPAuthScheme.API_KEY:
            if endpoint.secret_id is None:
                raise SecretNotFoundError(
                    missing=SecretOwnerKind.PROJECT,
                    target=_target_path(
                        namespace=target.namespace,
                        provider=target.provider,
                        integration=target.integration,
                        name=target.name,
                    ),
                    mode=SecretMode.PROJECT_ONLY,
                )
            secret = await self.resolver.resolve(
                scope=scope,
                ref=BoundSecretRef(secret_id=endpoint.secret_id),
                mode=SecretMode.PROJECT_ONLY,
            )
            return MCPDirectAuth(secret=secret)

        raise AssertionError(f"unsupported MCP auth mode: {endpoint.auth_mode!r}")

    async def _renewed(
        self,
        *,
        scope: AuthScope,
        target: _ResolvedTarget,
        endpoint: MCPEndpoint,
        secret: ResolvedSecret,
    ) -> ResolvedSecret:
        """Return a live grant for an OAuth endpoint, refreshing it if it has expired.

        Without this the relay sends an expired access token, the upstream answers 401,
        and the endpoint goes on reporting READY because a secret still exists (OR55).
        A grant that cannot be renewed is a grant only its owner can replace, so the
        endpoint is marked invalid — which is what `_connection_state` reads — and the
        caller gets the same reconnect affordance a never-connected endpoint gets.
        """
        grant = getattr(secret.secret.data, "grant", None)
        if not grant_settings_expired(grant):
            return secret

        server_url = endpoint.data.route.base_url or ""
        path = _target_path(
            namespace=target.namespace,
            provider=target.provider,
            integration=target.integration,
            name=target.name,
        )

        if self.oauth_refresher is None or not server_url:
            raise self._reconnect_required(endpoint=endpoint, path=path)

        try:
            await self.oauth_refresher.refresh_grant(
                project_id=scope.project_id,
                endpoint_id=endpoint.id,
                server_url=server_url,
            )
        except MCPOAuthRefreshFailedError as e:
            await self._invalidate_endpoint(
                scope=scope,
                endpoint=endpoint,
                presented_access_token=getattr(grant, "access_token", None),
            )
            raise self._reconnect_required(endpoint=endpoint, path=path) from e

        # The refresh rewrote the row this reference already names, so the same lookup
        # returns the new tokens.
        return await self.resolver.resolve(
            scope=scope,
            ref=BoundSecretRef(secret_id=endpoint.secret_id),  # type: ignore[arg-type]
            mode=SecretMode.PROJECT_ONLY,
        )

    @staticmethod
    def _reconnect_required(
        *, endpoint: MCPEndpoint, path: str
    ) -> MCPAuthRequiredError:
        return MCPAuthRequiredError(
            requirement=GatewayConnectionRequirement(
                target=path,
                state=GatewayConnectionState.NEEDS_AUTH,
                connect=GatewayConnectAffordance(
                    endpoint=f"/gateways/mcps/endpoints/{endpoint.id}/connect",
                    body={},
                ),
            )
        )

    async def _credential_was_replaced(
        self,
        *,
        scope: AuthScope,
        endpoint: MCPEndpoint,
        presented: Optional[str],
    ) -> bool:
        """Whether the connection now holds a different credential from the one that failed.

        A reconnect rewrites the grant in place, under the slug the connection's identity
        derives, so the row keeps its id and only the tokens inside it change. Comparing
        the row's id therefore cannot tell a repaired connection from the one that failed
        (D33): what moves is the access token, so that is what is compared.

        Reads through the resolver rather than the vault directly, which is the same path
        the relay used to obtain the credential in the first place. A grant that has gone
        entirely is not this caller's to invalidate either.
        """
        if presented is None or endpoint.secret_id is None:
            return False
        try:
            current = await self.resolver.resolve(
                scope=scope,
                ref=BoundSecretRef(secret_id=endpoint.secret_id),
                mode=SecretMode.PROJECT_ONLY,
            )
        except (SecretNotFoundError, SecretInvalidError):
            return True
        grant = getattr(current.secret.data, "grant", None)
        return getattr(grant, "access_token", None) != presented

    async def _invalidate_endpoint(
        self,
        *,
        scope: AuthScope,
        endpoint: MCPEndpoint,
        presented_access_token: Optional[str] = None,
    ) -> None:
        """Record that the endpoint's stored authorization is dead.

        Only a stored row can be marked: generated endpoints (builtin, standard) carry no
        persisted flags, and none of them reach this path.

        `presented_access_token` is the credential the failing call actually sent. The
        connection is marked invalid only while it still holds that credential, so a
        reconnect that landed during the round trip is not condemned by the 401 the old
        token earned.
        """
        if endpoint.namespace != GatewayEndpointNamespace.CUSTOM:
            return
        if not endpoint.flags.is_valid:
            return
        if await self._credential_was_replaced(
            scope=scope, endpoint=endpoint, presented=presented_access_token
        ):
            return
        # One column. This used to be a full PUT built from `endpoint`, which is the
        # snapshot read before the relay dialled the upstream, so an administrator who
        # deactivated the connection or tightened its tool filter while the call was in
        # flight had that change reverted by the eventual 401 (D3).
        await self.mcp_endpoints_dao.invalidate_endpoint_secret(
            project_id=scope.project_id,
            user_id=scope.user_id,  # type: ignore[arg-type]
            #
            endpoint_id=endpoint.id,
            # The handle this call was made with. Compared, never written: if a
            # reconnect landed while the call was in flight, the credential that failed
            # is not the one the connection holds now (D21).
            secret_id=endpoint.secret_id,
        )

    def _route_for(
        self, *, target: _ResolvedTarget, project_id: UUID
    ) -> MCPResolvedRoute:
        if (
            target.namespace == GatewayEndpointNamespace.BUILTIN
            and target.provider == COMPOSIO_PROVIDER
        ):
            return MCPResolvedRoute(
                url=_builtin_placeholder_url(
                    provider=target.provider or "",
                    integration=target.integration or "",
                    slug=target.name,
                )
            )
        endpoint = target.endpoint
        return MCPResolvedRoute(
            url=endpoint.data.route.base_url or "",
            headers=endpoint.data.route.headers or {},
            settings=endpoint.data.settings,
            credential_header=endpoint.data.route.credential_header,
            project_id=(
                project_id
                if target.namespace == GatewayEndpointNamespace.STANDARD
                and target.name == COMPOSIO_PROVIDER
                else None
            ),
        )

    def _outcome_for(
        self, *, result: MCPRelayResult, auth: MCPRelayAuth
    ) -> GatewayOutcome:
        if isinstance(auth, MCPDirectAuth) and auth.secret is not None:
            return GatewayOutcome(
                status_code=result.status_code,
                owner=auth.secret.owner,
                origin=auth.secret.origin,
            )
        # No secret resolved (NONE-scheme), or a MCPBrokeredAuth connection —
        # neither came from our resolver/vault, so owner/origin stay unset (§2.7:
        # "None when no secret was resolved").
        return GatewayOutcome(status_code=result.status_code)


def _filter_tool_list(
    *, result: MCPRelayResult, tools: MCPToolFilter
) -> MCPRelayResult:
    """Step 6's one body rewrite (§8): the filter drops whole tool entries, never
    renames a surviving one; an unconstrained filter passes the response through
    untouched. Scoped strictly to `tools/list`'s own JSON-RPC shape — never applied
    to resources/list or prompts/list, whose entries a tool filter says nothing
    about."""
    if tools.allowlist is None and tools.denylist is None:
        return result

    try:
        payload = json.loads(result.body) if result.body else None
    except (json.JSONDecodeError, TypeError):
        return result

    if not isinstance(payload, dict):
        return result
    listed = (payload.get("result") or {}).get("tools")
    if not isinstance(listed, list):
        return result

    payload["result"]["tools"] = [
        entry
        for entry in listed
        if isinstance(entry, dict) and tools.allows(str(entry.get("name")))
    ]

    return MCPRelayResult(
        status_code=result.status_code,
        headers=result.headers,
        body=json.dumps(payload).encode(),
    )


def _builtin_placeholder_url(*, provider: str, integration: str, slug: str) -> str:
    return f"composio://{provider}/{integration}/{slug}"
