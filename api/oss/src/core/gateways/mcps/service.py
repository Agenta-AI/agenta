"""`MCPGatewayService`: management + the transparent proxy (entities.md §8, WP9).

Wave 1 fills every method except the parts
of `relay` that would reach a brokered `builtin` target — D23: no such target is
reachable yet, and `ComposioMCPAdapter` has no owning package in this wave.
"""

import json
import re
from dataclasses import dataclass
from typing import Dict, List, Optional
from uuid import UUID

from oss.src.core.access.permissions.types import Permission
from oss.src.core.gateway.connections.dtos import Connection
from oss.src.core.gateway.connections.service import ConnectionsService
from oss.src.core.gateways.mcps.dtos import MCPAuthScheme
from oss.src.core.gateways.dtos import (
    GatewayConnectionState,
    GatewayEndpointNamespace,
)
from oss.src.core.gateways.mcps.dtos import (
    AGENTA_PROVIDER,
    COMPOSIO_PROVIDER,
    MCPBrokeredAuth,
    MCPCallContext,
    MCPDirectAuth,
    MCPEndpoint,
    MCPEndpointCreate,
    MCPEndpointData,
    MCPEndpointRoute,
    MCPEndpointEdit,
    MCPEndpointQuery,
    MCPRelayAuth,
    MCPResolvedRoute,
    MCPToolFilter,
)
from oss.src.core.gateways.mcps.interfaces import (
    MCPEndpointsDAOInterface,
    MCPRelayResult,
)
from oss.src.core.gateways.mcps.registry import MCPUpstreamRegistry
from oss.src.core.gateways.types import GatewayEndpointInactiveError
from oss.src.core.gateways.mcps.types import (
    MCPEndpointNotFoundError,
    MCPScopeInsufficientError,
    MCPToolNotAllowedError,
    MCPUpstreamError,
)
from oss.src.core.gateways.policy.dtos import (
    BoundSecretRef,
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

# Adapter selection (§8 step 5). `builtin` dispatches on its provider segment, since
# the namespace only says whose account pays, not which backend answers (D30).
_BUILTIN_ADAPTER_KEYS: Dict[str, str] = {
    AGENTA_PROVIDER: "mock",
    COMPOSIO_PROVIDER: "composio",
}


def _adapter_key(
    *, namespace: GatewayEndpointNamespace, provider: Optional[str]
) -> str:
    if namespace == GatewayEndpointNamespace.BUILTIN:
        key = _BUILTIN_ADAPTER_KEYS.get(provider or "")
        if key is None:
            raise MCPEndpointNotFoundError(namespace=namespace, name=provider or "")
        return key
    if namespace == GatewayEndpointNamespace.CUSTOM:
        return "http"
    # STANDARD: reserved, empty on the MCP plane (D30).
    raise MCPEndpointNotFoundError(namespace=namespace, name="")


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
    """RFC 6750 `WWW-Authenticate: Bearer error="insufficient_scope", scope="a b"` —
    the step-up challenge (D17, WP19). `None` when the response isn't one; `[]` when
    it is but the upstream omitted `scope` (WP18's dialog re-discovers the offered set
    either way, so a missing list degrades to "reopen the checklist", not a failure)."""
    header = next(
        (v for k, v in headers.items() if k.lower() == "www-authenticate"), None
    )
    if not header or not _INSUFFICIENT_SCOPE_RE.search(header):
        return None
    match = _SCOPE_PARAM_RE.search(header)
    return match.group(1).split() if match else []


def _target_path(
    *,
    namespace: GatewayEndpointNamespace,
    provider: Optional[str],
    integration: Optional[str],
    name: str,
) -> str:
    return "/".join(s for s in (namespace.value, provider, integration, name) if s)


class MCPGatewayService:
    def __init__(
        self,
        *,
        mcp_endpoints_dao: MCPEndpointsDAOInterface,
        policy: GatewayPolicyService,
        resolver: SecretsResolverInterface,
        upstream_registry: MCPUpstreamRegistry,
        # Not in entities.md §8's abbreviated constructor pseudocode, but §8's own prose
        # ("connection state resolved through the existing connections service") and
        # specs-wp9.md both require calling ConnectionsService.query_connections /
        # get_connection for real, in list_endpoints and in relay's builtin branch alike
        # ("the same instance list_endpoints already uses"). The abbreviated signature is
        # a gap in the design, not a instruction to mock the integration; flagged for
        # the M2 merge review rather than silently added.
        connections_service: ConnectionsService,
    ) -> None:
        self.mcp_endpoints_dao = mcp_endpoints_dao
        self.policy = policy
        self.resolver = resolver
        self.upstream_registry = upstream_registry
        self.connections_service = connections_service

    # --- management: thin DAO delegation ------------------------------------- #

    async def create_endpoint(
        self,
        *,
        project_id: UUID,
        user_id: UUID,
        #
        endpoint: MCPEndpointCreate,
    ) -> Optional[MCPEndpoint]:
        return await self.mcp_endpoints_dao.create_endpoint(
            project_id=project_id,
            user_id=user_id,
            #
            endpoint=endpoint,
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

    async def edit_endpoint(
        self,
        *,
        project_id: UUID,
        user_id: UUID,
        #
        endpoint: MCPEndpointEdit,
    ) -> Optional[MCPEndpoint]:
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

    # --- the three-namespace merge (D27) ------------------------------------- #

    async def list_endpoints(self, *, scope: AuthScope) -> List[MCPEndpoint]:
        """Takes the scope rather than a bare project_id (R14). §8 derives
        GatewayConnectionState "per owner and per namespace", which a project_id alone
        cannot express; `_connection_state` is the seam that wiring lands on."""
        project_id = scope.project_id
        custom = await self.mcp_endpoints_dao.query_endpoints(project_id=project_id)

        # is_active=None, like _resolve_target: D18 keeps a revoked connection's tools
        # listed, in NEEDS_AUTH, rather than making the endpoint disappear.
        connections = await self.connections_service.query_connections(
            project_id=project_id,
            provider_key="composio",
            is_active=None,
        )
        builtin = [self._builtin_endpoint(connection) for connection in connections]

        # builtin's two providers first (agenta, then composio), custom rows last — no
        # ordering guarantee is promised by entities.md §8.
        return [*self._agenta_endpoints(), *builtin, *custom]

    def _agenta_endpoints(self) -> List[MCPEndpoint]:
        """The endpoints Agenta itself serves — the `agenta` provider inside `builtin`
        (D23, D30). Private and
        service-internal — entities.md names no public symbol for this, unlike the LLM
        plane's `standard_llm_endpoint(s)`. Wave 1's only member is WP5's deployable
        mock MCP server; slug "tools" matches the route grammar's own worked example
        (D30: `/gateways/mcps/builtin/agenta/{slug}` -> `builtin/agenta/tools`)."""
        return [
            MCPEndpoint(
                slug="tools",
                name="Agenta Tools",
                auth_mode=MCPAuthScheme.NONE,
                namespace=GatewayEndpointNamespace.BUILTIN,
                provider_key=AGENTA_PROVIDER,
                data=MCPEndpointData(
                    route=MCPEndpointRoute(base_url=env.mock_gateways.mcp_url)
                ),
            )
        ]

    def _builtin_endpoint(self, connection: Connection) -> MCPEndpoint:
        """One generated (never persisted, D19/D20) `MCPEndpoint` per active composio
        `Connection`. `data.url` is a non-dialable placeholder: no document in this
        design fixes a real Composio MCP base URL, and D23 keeps every `builtin` MCP
        target unreachable this wave (`ComposioMCPAdapter` has no owner) — a
        placeholder keeps the required field populated without inventing an endpoint
        nobody owns yet."""
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
                )
            ),
        )

    # --- connection-state derivation (entities.md §8, "Where the state machine is
    # computed") ---------------------------------------------------------------- #

    async def _connection_state(
        self,
        *,
        project_id: UUID,
        user_id: Optional[UUID],
        #
        endpoint: MCPEndpoint,
    ) -> GatewayConnectionState:
        """Per owner, per namespace (§8, verbatim in specs-wp9.md). Not called by
        `list_endpoints` in wave 1 — that method takes no owner, so it cannot derive a
        per-caller state — this is exercised directly by its own unit tests and is the
        seam a future per-owner read (the CRUD router, or the connect-affordance
        builder, D17) calls into. Nothing here is stored (§2.6): every call recomputes."""
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

        # NEEDS_INPUT is reserved for the api_key scheme, deferred with its kind (D14);
        # unreachable today because no custom endpoint can carry auth_mode=API_KEY yet.
        return GatewayConnectionState.NEEDS_AUTH

    # --- the data plane (WP8 calls this) --------------------------------------- #

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
    ) -> MCPRelayResult:
        """The six-step orchestration (§8, D7 applied to MCP)."""

        # `_ResolvedTarget` is a plain dataclass, not a pydantic model, so a caller
        # passing the namespace as a bare string (the FastAPI path-param case, or a
        # test) is not auto-coerced the way GatewayTarget's own field would be —
        # every downstream `.value` access (MCPEndpointNotFoundError, _adapter_key)
        # needs a real enum member.
        namespace = GatewayEndpointNamespace(namespace)

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
        if not decision.allowed:
            await self.policy.record(
                scope=scope,
                target=policy_target,
                decision=decision,
                outcome=GatewayOutcome(status_code=403),
            )
            raise PolicyDeniedError(
                permission=Permission.USE_MCP_ENDPOINTS,
                target=_target_path(
                    namespace=namespace,
                    provider=provider,
                    integration=integration,
                    name=name,
                ),
            )

        # 4. Resolve secret — the two-mechanism fork (D27, §4.4).
        auth = await self._resolve_auth(scope=scope, target=target)

        # 5. Dispatch. Usage is recorded even on failure.
        route = self._route_for(target)
        adapter_key = _adapter_key(namespace=namespace, provider=provider)
        try:
            result = await self.upstream_registry.get(adapter_key).relay(
                route=route,
                auth=auth,
                context=context,
                body=body,
                headers=headers,
            )
        except MCPUpstreamError as exc:
            await self.policy.record(
                scope=scope,
                target=policy_target,
                decision=decision,
                outcome=GatewayOutcome(status_code=exc.status_code),
            )
            raise

        # 5b. Step-up (D17, WP19): a `custom` OAuth target's upstream answering 403 with
        # an RFC 6750 `insufficient_scope` challenge raises an interaction instead of
        # passing the refusal through — same treatment `_resolve_auth` already gives a
        # missing secret, one step later (after dial, since the challenge is the
        # upstream's to raise, not ours to predict).
        if (
            namespace == GatewayEndpointNamespace.CUSTOM
            and target.endpoint.auth_mode == MCPAuthScheme.OAUTH
            and result.status_code == 403
        ):
            challenged_scopes = _parse_scope_challenge(result.headers)
            if challenged_scopes is not None:
                await self.policy.record(
                    scope=scope,
                    target=policy_target,
                    decision=decision,
                    outcome=GatewayOutcome(status_code=403),
                )
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

        # 6. Record, then — for a list method — filter the response body.
        await self.policy.record(
            scope=scope,
            target=policy_target,
            decision=decision,
            outcome=self._outcome_for(result=result, auth=auth),
        )

        if context.method == "tools/list":
            result = _filter_tool_list(result=result, tools=target.endpoint.data.tools)

        return result

    # --- relay step helpers ----------------------------------------------------- #

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
        if target.provider == COMPOSIO_PROVIDER:
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
        if endpoint.auth_mode == MCPAuthScheme.NONE:
            return MCPDirectAuth(secret=None)

        if endpoint.auth_mode == MCPAuthScheme.OAUTH:
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
                mode=SecretMode.PROJECT_ONLY,  # one consent per server (out-of-scope.md)
            )
            return MCPDirectAuth(secret=secret)

        # API_KEY: no static MCP secret kind exists yet (D14) — deferred with its kind.
        raise NotImplementedError("api_key scheme MCP endpoints are deferred (D14)")

    def _route_for(self, target: _ResolvedTarget) -> MCPResolvedRoute:
        if target.provider == COMPOSIO_PROVIDER:
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
