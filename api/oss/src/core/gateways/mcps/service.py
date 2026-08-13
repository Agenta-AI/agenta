"""`McpGatewayService`: management + the transparent proxy (entities.md §8, WP9).

Wave 1 fills every method except the grants block (WP17/WP18 wire those) and the parts
of `relay` that would reach a brokered `builtin` target — D23: no such target is
reachable yet, and `ComposioMcpAdapter` has no owning package in this wave.
"""

from typing import List, Optional
from uuid import UUID

from oss.src.core.gateway.connections.service import ConnectionsService
from oss.src.core.gateways.mcps.dtos import (
    McpEndpoint,
    McpEndpointCreate,
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
