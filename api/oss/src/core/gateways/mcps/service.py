"""`McpGatewayService`: management + the transparent proxy (entities.md §8, WP9).

Wave 1 fills every method except the grants block (WP17/WP18 wire those) and the parts
of `relay` that would reach a brokered `builtin` target — D23: no such target is
reachable yet, and `ComposioMcpAdapter` has no owning package in this wave.
"""

from typing import List, Optional
from uuid import UUID

from oss.src.core.gateway.connections.dtos import Connection
from oss.src.core.gateway.connections.service import ConnectionsService
from oss.src.core.gateways.dtos import (
    GatewayAuthScheme,
    GatewayConnectionState,
    GatewayEndpointNamespace,
)
from oss.src.core.gateways.mcps.dtos import (
    McpEndpoint,
    McpEndpointCreate,
    McpEndpointData,
    McpEndpointEdit,
    McpEndpointQuery,
)
from oss.src.core.gateways.mcps.interfaces import (
    McpEndpointsDAOInterface,
    McpGrantsDAOInterface,
)
from oss.src.core.gateways.mcps.registry import McpUpstreamRegistry
from oss.src.core.gateways.policy.interfaces import CredentialResolverInterface
from oss.src.core.gateways.policy.service import GatewayPolicyService
from oss.src.core.shared.dtos import Windowing
from oss.src.utils.env import env


class McpGatewayService:
    def __init__(
        self,
        *,
        mcp_endpoints_dao: McpEndpointsDAOInterface,
        mcp_grants_dao: McpGrantsDAOInterface,
        policy: GatewayPolicyService,
        resolver: CredentialResolverInterface,
        upstream_registry: McpUpstreamRegistry,
        # Not in entities.md §8's abbreviated constructor pseudocode, but §8's own prose
        # ("connection state resolved through the existing connections service") and
        # specs-wp9.md both require calling ConnectionsService.query_connections /
        # get_connection for real, in list_endpoints and in relay's builtin branch alike
        # ("the same instance list_endpoints already uses"). The abbreviated signature is
        # a gap in the design, not a instruction to fake the integration; flagged for
        # the M2 merge review rather than silently added.
        connections_service: ConnectionsService,
    ) -> None:
        self.mcp_endpoints_dao = mcp_endpoints_dao
        self.mcp_grants_dao = mcp_grants_dao
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
        endpoint: McpEndpointCreate,
    ) -> Optional[McpEndpoint]:
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
    ) -> Optional[McpEndpoint]:
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
        endpoint: McpEndpointEdit,
    ) -> Optional[McpEndpoint]:
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
        endpoint: Optional[McpEndpointQuery] = None,
        #
        windowing: Optional[Windowing] = None,
    ) -> List[McpEndpoint]:
        return await self.mcp_endpoints_dao.query_endpoints(
            project_id=project_id,
            #
            endpoint=endpoint,
            #
            windowing=windowing,
        )

    # --- the three-namespace merge (D27) ------------------------------------- #

    async def list_endpoints(self, *, project_id: UUID) -> List[McpEndpoint]:
        custom = await self.mcp_endpoints_dao.query_endpoints(project_id=project_id)

        connections = await self.connections_service.query_connections(
            project_id=project_id,
            provider_key="composio",
        )
        builtin = [self._builtin_endpoint(connection) for connection in connections]

        # agenta first, builtin generated, custom rows last — no ordering guarantee is
        # promised by entities.md §8; this order only mirrors the route grammar's own
        # listing (agenta, builtin, custom).
        return [*self._agenta_endpoints(), *builtin, *custom]

    def _agenta_endpoints(self) -> List[McpEndpoint]:
        """The code-defined agenta-namespace entries (D23, D27). Private and
        service-internal — entities.md names no public symbol for this, unlike the LLM
        plane's `standard_llm_endpoint(s)`. Wave 1's only member is WP5's deployable
        fake MCP server; slug "tools" matches the route grammar's own worked example
        (decisions.md D27: `/gateways/mcps/agenta/{slug}` -> `agenta/tools`)."""
        return [
            McpEndpoint(
                slug="tools",
                name="Agenta Tools",
                auth_mode=GatewayAuthScheme.NONE,
                namespace=GatewayEndpointNamespace.AGENTA,
                data=McpEndpointData(url=env.fake_gateways.mcp_url),
            )
        ]

    def _builtin_endpoint(self, connection: Connection) -> McpEndpoint:
        """One generated (never persisted, D19/D20) `McpEndpoint` per active composio
        `Connection`. `data.url` is a non-dialable placeholder: no document in this
        design fixes a real Composio MCP base URL, and D23 keeps every `builtin` MCP
        target unreachable this wave (`ComposioMcpAdapter` has no owner) — a
        placeholder keeps the required field populated without inventing an endpoint
        nobody owns yet."""
        return McpEndpoint(
            slug=connection.slug,
            name=connection.name,
            namespace=GatewayEndpointNamespace.BUILTIN,
            connection_id=connection.id,
            provider_key=connection.provider_key.value,
            integration_key=connection.integration_key,
            auth_mode=(
                GatewayAuthScheme.NONE
                if not connection.has_auth
                else GatewayAuthScheme.OAUTH
            ),
            data=McpEndpointData(
                url=_builtin_placeholder_url(
                    provider=connection.provider_key.value,
                    integration=connection.integration_key,
                    slug=connection.slug,
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
        endpoint: McpEndpoint,
    ) -> GatewayConnectionState:
        """Per owner, per namespace (§8, verbatim in specs-wp9.md). Not called by
        `list_endpoints` in wave 1 — that method takes no owner, so it cannot derive a
        per-caller state — this is exercised directly by its own unit tests and is the
        seam a future per-owner read (the CRUD router, or the connect-affordance
        builder, D17) calls into. Nothing here is stored (§2.6): every call recomputes."""
        if endpoint.auth_mode == GatewayAuthScheme.NONE:
            return GatewayConnectionState.READY

        if endpoint.namespace == GatewayEndpointNamespace.CUSTOM:
            grant = await self.mcp_grants_dao.fetch_grant(
                project_id=project_id,
                endpoint_id=endpoint.id,
                user_id=user_id,
            )
            if grant is not None and grant.flags.is_valid:
                return GatewayConnectionState.READY
            return GatewayConnectionState.NEEDS_AUTH

        if endpoint.namespace == GatewayEndpointNamespace.BUILTIN:
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


def _builtin_placeholder_url(*, provider: str, integration: str, slug: str) -> str:
    return f"composio://{provider}/{integration}/{slug}"
