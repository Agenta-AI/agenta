"""The executor's three ports: to an upstream, to the wallet, and to a rate limiter."""

from abc import ABC, abstractmethod
from typing import Any, Dict, Optional
from uuid import UUID

from oss.src.core.managed_tools.dtos import (
    ManagedAction,
    ManagedActionContext,
    ManagedActionMeasurement,
    ManagedActionPrice,
    ManagedActionRateLimit,
    ManagedActionResponse,
)


class ManagedActionProviderInterface(ABC):
    """One connection to an upstream, built with its own credentials and settings. Each
    transport (direct REST, MCP, Composio) is one implementation.

    `invoke` returns a response when the upstream answered, success or failure. It raises
    `ManagedActionNotSentError` only when the request provably never left; anything else it
    raises is an unknown outcome. It must never retry: one retry is one more purchase.

    Every provider spends an account Agenta owns. A customer's own connection never
    becomes one: it stays on the customer's existing tool paths, which are never charged.
    Failure messages must be safe to show the model: never a credential, a header or a raw
    exception string."""

    name: str
    rate_limit: Optional[ManagedActionRateLimit] = None

    @abstractmethod
    async def invoke(
        self,
        *,
        operation: str,
        arguments: Dict[str, Any],
        context: ManagedActionContext,
    ) -> ManagedActionResponse:
        raise NotImplementedError


class ManagedActionBillingInterface(ABC):
    """The wallet's side: what an action costs, whether an organization may pay it, and
    what a dispatched execution consumed. Implementations may raise or stall; the executor
    bounds every call and fails closed on admission."""

    @abstractmethod
    async def prices(self) -> Dict[str, ManagedActionPrice]:
        """Prices keyed by action key."""
        raise NotImplementedError

    @abstractmethod
    async def admit(self, *, organization_id: UUID, action: ManagedAction) -> bool:
        """Whether the organization can pay this action's worst-case price."""
        raise NotImplementedError

    @abstractmethod
    async def record(self, *, measurement: ManagedActionMeasurement) -> None:
        raise NotImplementedError


class ManagedActionRateLimiterInterface(ABC):
    @abstractmethod
    async def acquire(
        self,
        *,
        provider: str,
        organization_id: UUID,
        limit: ManagedActionRateLimit,
    ) -> Optional[int]:
        """None when a token was taken; otherwise the milliseconds to wait."""
        raise NotImplementedError
