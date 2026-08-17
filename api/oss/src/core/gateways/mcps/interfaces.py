"""MCP plane DAO interfaces and south port (entities.md §7, §7.1).

The registry lives in `registry.py`, per §0's file layout. §7.1 shows it in the same code
block as the port, which is presentation, not placement (R13).

DAOs open their own sessions; services never touch the engine. `project_id` is first on
every method (tenant scope is structural); `user_id` on writes only.
"""

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
    """A single JSON answer. The gateway targets the stateless revision in JSON
    mode — one request, one `application/json` response, 202 for notifications
    (`mcp.md`; the in-tree precedent is the runner's internal tool server,
    services/runner/src/tools/tool-mcp-http.ts). No SSE leg to carry."""

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
        """Transparent per-server relay (D16): same method, same body, same
        response, with only the route and the authorization changed. `auth` is
        the discriminated union from §4.4 — MCPDirectAuth for agenta and custom,
        MCPBrokeredAuth for builtin — so the two secret mechanisms cannot be
        conflated by an adapter (D27). Raises MCPUpstreamError on transport
        failure; protocol-level errors from the server are NOT exceptions — they
        are the response body, relayed, because the server's own failure reason
        is what lets the model correct itself (the pass-through rule in
        api/AGENTS.md's error-envelope scope).

        A `custom` route's URL was typed by a user and the adapter is what
        connects to it, so the outbound guard runs here before the POST: the
        resolving variant in core/webhooks/utils.py, connecting to the literal
        IP it returns rather than re-resolving the hostname (D28). A blocked
        target is MCPUpstreamError — a transport refusal, never relayed as an
        upstream body. Only `custom` needs it: agenta targets are ours and
        builtin targets are the broker's."""
        raise NotImplementedError
