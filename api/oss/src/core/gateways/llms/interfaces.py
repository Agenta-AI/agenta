"""LLM plane DAO interface, south port, and upstream registry (entities.md §7, §7.1).

DAOs open their own sessions; services never touch the engine. `project_id` is first on
every method (tenant scope is structural); `user_id` on writes only.
"""

from abc import ABC, abstractmethod
from dataclasses import dataclass
from typing import AsyncIterator, Dict, List, Optional
from uuid import UUID

from oss.src.core.gateways.llms.dtos import (
    LlmCallContext,
    LlmEndpoint,
    LlmEndpointCreate,
    LlmEndpointEdit,
    LlmEndpointQuery,
    LlmResolvedRoute,
)
from oss.src.core.gateways.policy.dtos import GatewayUsage, ResolvedCredential
from oss.src.core.shared.dtos import Windowing


class LlmEndpointsDAOInterface(ABC):
    """Persistence contract for custom LLM endpoints. Standard endpoints are
    generated (D20) and never pass through this interface — the service merges
    them in from catalog.py, which is why nothing here has a namespace
    parameter: every row is custom by construction (§2.3)."""

    @abstractmethod
    async def create_endpoint(
        self,
        *,
        project_id: UUID,
        user_id: UUID,
        #
        endpoint: LlmEndpointCreate,
    ) -> Optional[LlmEndpoint]:
        """Insert. Raises EntityCreationConflict on a slug collision — the one
        exception a create surfaces, per the connections DAO discipline."""
        raise NotImplementedError

    @abstractmethod
    async def fetch_endpoint(
        self,
        *,
        project_id: UUID,
        #
        endpoint_id: UUID,
    ) -> Optional[LlmEndpoint]:
        raise NotImplementedError

    @abstractmethod
    async def fetch_endpoint_by_slug(
        self,
        *,
        project_id: UUID,
        #
        slug: str,
    ) -> Optional[LlmEndpoint]:
        """The data-plane route lookup (§2.3). Backed by
        uq_llm_gateway_endpoints_project_slug, so at most one row by
        construction. None means the custom namespace has no such name — the
        proxy 404s in the surface's own error shape (§9)."""
        raise NotImplementedError

    @abstractmethod
    async def edit_endpoint(
        self,
        *,
        project_id: UUID,
        user_id: UUID,
        #
        endpoint: LlmEndpointEdit,
    ) -> Optional[LlmEndpoint]:
        """Full PUT over the editable surface (§4.3): data, flags, header,
        secret_id. provider_key and deployment are absent from the Edit DTO and
        therefore untouchable here."""
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
        endpoint: Optional[LlmEndpointQuery] = None,
        #
        windowing: Optional[Windowing] = None,
    ) -> List[LlmEndpoint]:
        raise NotImplementedError


# --- the south port ---------------------------------------------------------- #


@dataclass
class LlmRelayResult:
    """One upstream answer, streaming or not. `body` yields exactly one chunk
    for a non-streaming call. `usage` is populated by the adapter once `body`
    is exhausted, when the upstream exposed it (the OpenAI stream carries a
    trailing usage frame; the translated adapter reports the library's count);
    None means unknowable, and the audit event says so rather than guessing."""

    status_code: int
    headers: Dict[str, str]
    body: AsyncIterator[bytes]
    usage: Optional[GatewayUsage] = None


class LlmUpstreamInterface(ABC):
    """Turns a resolved route plus a resolved credential into an upstream call.
    The core never imports an implementation; wiring happens at the entrypoint."""

    @abstractmethod
    async def relay_chat_completion(
        self,
        *,
        route: LlmResolvedRoute,
        credential: Optional[ResolvedCredential],
        #
        context: LlmCallContext,
        body: bytes,
        headers: Dict[str, str],
    ) -> LlmRelayResult:
        """Relay one completion call. `body` is the caller's payload untouched;
        `headers` are the caller's headers already stripped of authorization.
        `credential` is None only for targets whose auth scheme is NONE (the
        fakes). Raises LlmUpstreamError on upstream failure."""
        raise NotImplementedError

    # async def relay_embedding(...) -> LlmRelayResult — deferred with the evaluator path (D15)


class LlmUpstreamRegistry:
    def __init__(self, *, adapters: Dict[str, LlmUpstreamInterface]) -> None:
        raise NotImplementedError

    def get(self, key: str) -> LlmUpstreamInterface:
        raise NotImplementedError

    def keys(self) -> list[str]:
        raise NotImplementedError
