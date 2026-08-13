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
    McpCallContext,
    McpEndpoint,
    McpEndpointCreate,
    McpEndpointEdit,
    McpEndpointQuery,
    McpGrant,
    McpGrantCreate,
    McpGrantQuery,
    McpRelayAuth,
    McpResolvedRoute,
)
from oss.src.core.shared.dtos import Status, Windowing


class McpEndpointsDAOInterface(ABC):
    """Same six verbs, same semantics, over mcp_gateway_endpoints."""

    @abstractmethod
    async def create_endpoint(
        self,
        *,
        project_id: UUID,
        user_id: UUID,
        #
        endpoint: McpEndpointCreate,
    ) -> Optional[McpEndpoint]:
        raise NotImplementedError

    @abstractmethod
    async def fetch_endpoint(
        self,
        *,
        project_id: UUID,
        #
        endpoint_id: UUID,
    ) -> Optional[McpEndpoint]:
        raise NotImplementedError

    @abstractmethod
    async def fetch_endpoint_by_slug(
        self,
        *,
        project_id: UUID,
        #
        slug: str,
    ) -> Optional[McpEndpoint]:
        raise NotImplementedError

    @abstractmethod
    async def edit_endpoint(
        self,
        *,
        project_id: UUID,
        user_id: UUID,
        #
        endpoint: McpEndpointEdit,
    ) -> Optional[McpEndpoint]:
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
        endpoint: Optional[McpEndpointQuery] = None,
        #
        windowing: Optional[Windowing] = None,
    ) -> List[McpEndpoint]:
        raise NotImplementedError


class McpGrantsDAOInterface(ABC):
    """Persistence contract for grant rows. The owner is a key here, not
    authorship — this is where D10 is storage, not just signature (§2.2)."""

    @abstractmethod
    async def create_grant(
        self,
        *,
        project_id: UUID,
        user_id: Optional[UUID],
        #
        grant: McpGrantCreate,
    ) -> Optional[McpGrant]:
        """Insert, idempotent on the owner: `ON CONFLICT DO NOTHING ...
        RETURNING`, falling back to a fetch — a re-entered OAuth callback
        returns the EXISTING row rather than None, because the caller still
        needs the row either way (the outbox rule from channels, same reason).
        The partial unique indexes in §2.5 carry the conflict.

        `user_id` here is the OWNER (grant.user_id mirrors it); authorship
        lands in created_by_id from the same value when present."""
        raise NotImplementedError

    @abstractmethod
    async def fetch_grant(
        self,
        *,
        project_id: UUID,
        #
        endpoint_id: UUID,
        user_id: Optional[UUID],
    ) -> Optional[McpGrant]:
        """The resolution read: THIS owner's grant on THIS endpoint.
        user_id=None selects the project-owned grant — it does not mean "any".
        The fallback walk (user's, else project's, per CredentialMode) belongs
        to the resolver, which calls this at most twice; putting the fallback
        in SQL would hide the mode logic where it cannot be unit-tested."""
        raise NotImplementedError

    @abstractmethod
    async def fetch_grant_by_id(
        self,
        *,
        project_id: UUID,
        #
        grant_id: UUID,
    ) -> Optional[McpGrant]:
        raise NotImplementedError

    @abstractmethod
    async def update_grant(
        self,
        *,
        project_id: UUID,
        #
        grant_id: UUID,
        is_valid: Optional[bool] = None,
        status: Optional[Status] = None,
    ) -> Optional[McpGrant]:
        """Server-set operational state only (§2.6): flip is_valid, record the
        refresh outcome. Deliberately NOT an edit_grant taking a document —
        there is no grant document to edit (§6), and this update must not be
        able to move endpoint_id, user_id or secret_id."""
        raise NotImplementedError

    @abstractmethod
    async def delete_grant(
        self,
        *,
        project_id: UUID,
        #
        grant_id: UUID,
    ) -> bool:
        """Row only. The service deletes the vault secret FIRST, then this —
        the SSO delete order (§2.1); the CASCADE covers the reverse arrival."""
        raise NotImplementedError

    @abstractmethod
    async def query_grants(
        self,
        *,
        project_id: UUID,
        #
        grant: Optional[McpGrantQuery] = None,
        #
        windowing: Optional[Windowing] = None,
    ) -> List[McpGrant]:
        raise NotImplementedError


# --- the south port ---------------------------------------------------------- #


@dataclass
class McpRelayResult:
    """A single JSON answer. The gateway targets the stateless revision in JSON
    mode — one request, one `application/json` response, 202 for notifications
    (`mcp.md`; the in-tree precedent is the runner's internal tool server,
    services/runner/src/tools/tool-mcp-http.ts). No SSE leg to carry."""

    status_code: int
    headers: Dict[str, str]
    body: bytes


class McpUpstreamInterface(ABC):
    @abstractmethod
    async def relay(
        self,
        *,
        route: McpResolvedRoute,
        auth: McpRelayAuth,
        #
        context: McpCallContext,
        body: bytes,
        headers: Dict[str, str],
    ) -> McpRelayResult:
        """Transparent per-server relay (D16): same method, same body, same
        response, with only the route and the authorization changed. `auth` is
        the discriminated union from §4.4 — McpDirectAuth for agenta and custom,
        McpBrokeredAuth for builtin — so the two credential mechanisms cannot be
        conflated by an adapter (D27). Raises McpUpstreamError on transport
        failure; protocol-level errors from the server are NOT exceptions — they
        are the response body, relayed, because the server's own failure reason
        is what lets the model correct itself (the pass-through rule in
        api/AGENTS.md's error-envelope scope).

        A `custom` route's URL was typed by a user and the adapter is what
        connects to it, so the outbound guard runs here before the POST: the
        resolving variant in core/webhooks/utils.py, connecting to the literal
        IP it returns rather than re-resolving the hostname (D28). A blocked
        target is McpUpstreamError — a transport refusal, never relayed as an
        upstream body. Only `custom` needs it: agenta targets are ours and
        builtin targets are the broker's."""
        raise NotImplementedError
