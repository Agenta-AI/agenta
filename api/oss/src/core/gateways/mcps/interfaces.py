"""MCP endpoint persistence and relay interfaces."""

from abc import ABC, abstractmethod
from dataclasses import dataclass
from typing import Dict, List, Optional
from uuid import UUID

from oss.src.core.gateways.mcps.dtos import (
    MCPCallContext,
    MCPEndpoint,
    MCPEndpointCreate,
    MCPEndpointEdit,
    MCPEndpointQuery,
    MCPRelayAuth,
    MCPResolvedRoute,
)
from oss.src.core.shared.dtos import Windowing


class MCPEndpointsDAOInterface(ABC):
    """Same six verbs, same semantics, over mcps_endpoints."""

    @abstractmethod
    async def create_endpoint(
        self,
        *,
        project_id: UUID,
        user_id: UUID,
        #
        endpoint: MCPEndpointCreate,
    ) -> Optional[MCPEndpoint]:
        raise NotImplementedError

    @abstractmethod
    async def fetch_endpoint(
        self,
        *,
        project_id: UUID,
        #
        endpoint_id: UUID,
    ) -> Optional[MCPEndpoint]:
        raise NotImplementedError

    @abstractmethod
    async def fetch_endpoint_by_slug(
        self,
        *,
        project_id: UUID,
        #
        slug: str,
    ) -> Optional[MCPEndpoint]:
        raise NotImplementedError

    @abstractmethod
    async def edit_endpoint(
        self,
        *,
        project_id: UUID,
        user_id: UUID,
        #
        endpoint: MCPEndpointEdit,
    ) -> Optional[MCPEndpoint]:
        raise NotImplementedError

    @abstractmethod
    async def delete_endpoint(
        self,
        *,
        project_id: UUID,
        #
        endpoint_id: UUID,
    ) -> bool:
        raise NotImplementedError

    @abstractmethod
    async def query_endpoints(
        self,
        *,
        project_id: UUID,
        #
        endpoint: Optional[MCPEndpointQuery] = None,
        #
        windowing: Optional[Windowing] = None,
    ) -> List[MCPEndpoint]:
        raise NotImplementedError


# --- the south port ---------------------------------------------------------- #


@dataclass
class MCPRelayResult:
    """One MCP relay response."""

    status_code: int
    headers: Dict[str, str]
    body: bytes


class MCPUpstreamInterface(ABC):
    @abstractmethod
    async def relay(
        self,
        *,
        route: MCPResolvedRoute,
        auth: MCPRelayAuth,
        #
        context: MCPCallContext,
        body: bytes,
        headers: Dict[str, str],
    ) -> MCPRelayResult:
        """Relay a request while preserving the upstream protocol response."""
        raise NotImplementedError
