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
    async def bind_endpoint_secret(
        self,
        *,
        project_id: UUID,
        user_id: UUID,
        #
        endpoint_id: UUID,
        secret_id: Optional[UUID],
    ) -> Optional[MCPEndpoint]:
        """Point a connection at its stored authorization, or at none, and mark it valid.

        `secret_id=None` is the disconnect: the handle goes and the connection stays
        valid, because nothing died — it simply holds no authorization now.

        Separate from `edit_endpoint` because a credential transition is not an edit of
        the connection. `edit_endpoint` is a full PUT built from a snapshot the caller
        read earlier, so expressing "the grant changed" through it wrote back every other
        column as the caller last saw it: fields the builder omitted were nulled, and an
        administrator's concurrent change was reverted (D3). This writes two columns.
        """
        raise NotImplementedError

    @abstractmethod
    async def invalidate_endpoint_secret(
        self,
        *,
        project_id: UUID,
        user_id: UUID,
        #
        endpoint_id: UUID,
        secret_id: Optional[UUID],
    ) -> Optional[MCPEndpoint]:
        """Record that a connection's stored authorization is dead, touching nothing else.

        `secret_id` is the handle the caller was using, and it is a precondition rather
        than a value to write: the row is marked invalid only while it still names that
        handle. The relay decides this after a round trip the connection may have been
        reconfigured during, so writing back what it read would undo a concurrent
        change, and invalidating without looking would condemn a credential a reconnect
        has already replaced (D21).
        """
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
