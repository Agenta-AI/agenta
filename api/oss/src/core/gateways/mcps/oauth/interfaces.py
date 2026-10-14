"""Interfaces for MCP OAuth: attempt persistence, and grant refresh."""

from abc import ABC, abstractmethod
from datetime import datetime
from typing import AsyncContextManager, Awaitable, Callable, Optional
from uuid import UUID

from oss.src.core.gateways.mcps.oauth.dtos import (
    MCPOAuthAttempt,
    MCPOAuthAttemptCreate,
    MCPOAuthAttemptStatus,
)


class MCPOAuthRefresherInterface(ABC):
    """Exchange a stored refresh token for a fresh grant.

    The data plane needs this and owns none of it: the tokens live in the vault and the
    exchange is an OAuth call. Stating it as an interface keeps `MCPGatewayService`
    unaware of the connect service, which in turn depends on the vault and the OAuth
    client.
    """

    @abstractmethod
    async def refresh_grant(
        self, *, project_id: UUID, endpoint_id: UUID, server_url: str
    ) -> None:
        """Refresh one connection's stored grant, in place.

        `endpoint_id` is which grant, because several connections in one project can
        name the same server and each holds its own. `server_url` is where to rediscover
        the token endpoint, which is routing rather than identity.

        Returns nothing: the caller re-reads the secret it already holds a reference to,
        because the refreshed tokens are written back to that same row. Raises
        `MCPOAuthRefreshFailedError` when no usable grant can be produced.
        """
        raise NotImplementedError

    @abstractmethod
    async def release_grant(
        self, *, project_id: UUID, endpoint_id: UUID, server_url: str
    ) -> None:
        """Retire a connection's grant after an edit moved it off OAuth or to another
        address. The edit clears the binding itself; this cancels the attempts still in
        flight and removes the grant row unless a newer consent bound it."""
        raise NotImplementedError

    @abstractmethod
    async def cancel(
        self,
        *,
        project_id: UUID,
        endpoint_id: UUID,
        attempt_id: Optional[UUID] = None,
    ) -> int:
        """Cancel one active attempt, or every active attempt of a connection."""
        raise NotImplementedError


# Records how a locked attempt ended, inside the transaction that holds its lock.
MCPOAuthAttemptSettler = Callable[[MCPOAuthAttemptStatus], Awaitable[None]]


class MCPOAuthAttemptsDAOInterface(ABC):
    """Read, consume and expire the records that back the opaque `state` handle."""

    @abstractmethod
    async def create_attempt(
        self,
        *,
        attempt: MCPOAuthAttemptCreate,
    ) -> MCPOAuthAttempt:
        raise NotImplementedError

    @abstractmethod
    async def fetch_attempt(
        self,
        *,
        state: str,
    ) -> Optional[MCPOAuthAttempt]:
        """Read an attempt without consuming it, so a caller that is going to be
        refused anyway does not burn a handle the rightful browser still needs."""
        raise NotImplementedError

    @abstractmethod
    async def fetch_attempt_by_id(
        self,
        *,
        project_id: UUID,
        endpoint_id: UUID,
        attempt_id: UUID,
    ) -> Optional[MCPOAuthAttempt]:
        """Read one attempt the way the browser names it: by id, inside its project and
        connection. The browser never holds `state`."""
        raise NotImplementedError

    @abstractmethod
    async def consume_attempt(
        self,
        *,
        state: str,
    ) -> Optional[MCPOAuthAttempt]:
        """Move a pending attempt to `claimed` and return it as it was, in one transaction.

        Exactly one caller can be handed a given record: a second concurrent consumer
        finds it no longer pending and gets `None`. The verifier is blanked on the row as
        it is claimed, so it is readable for one exchange and no longer. Expiry is NOT
        applied here: an expired record is still consumed, and the caller decides what to
        say about it, so an expired handle cannot be probed repeatedly either.

        The row itself stays until the sweep, carrying the outcome the callback writes,
        so the browser can ask how the attempt ended when the popup's message is lost.
        """
        raise NotImplementedError

    @abstractmethod
    async def settle_attempt(
        self,
        *,
        attempt_id: UUID,
        status: MCPOAuthAttemptStatus,
        error: Optional[str] = None,
    ) -> None:
        """Record how a claimed attempt ended. An attempt no longer claimed, because a
        cancel or another outcome got there first, is left as it is."""
        raise NotImplementedError

    @abstractmethod
    def finalize_attempt(
        self,
        *,
        attempt_id: UUID,
    ) -> AsyncContextManager[Optional[MCPOAuthAttemptSettler]]:
        """Lock a claimed, unexpired attempt for the rest of the block.

        Yields a settler while the attempt is still active, and `None` when it was
        cancelled or has expired. A cancel arriving while the block runs waits for it, so
        the outcome recorded inside the block cannot be overtaken. The outcome is
        committed when the block ends without raising.

        The lock lives on its own connection, so DAO calls inside the block that commit
        their own sessions do not release it. Lock order is required: the attempt row
        first, then the endpoint row. Every path that takes both (this block's bind, a
        cancel, `release_grant`) takes them in that order, or two of them can wait on
        each other with no way for the database to see it.
        """
        raise NotImplementedError

    @abstractmethod
    async def cancel_attempts(
        self,
        *,
        project_id: UUID,
        endpoint_id: UUID,
        attempt_id: Optional[UUID] = None,
    ) -> int:
        """Cancel one connection's active attempts, or the one named, and return how many.

        Active is pending or claimed: a claimed attempt is mid-exchange, and its
        finalization re-checks the attempt under its lock, so the cancel wins.

        A consent already in flight completes against the record it was issued, so
        without this a browser tab opened before a cancel, a disconnect or a change of
        mode or address finishes afterwards and binds a grant nobody wants (D5). A
        cancelled attempt's callback writes nothing.
        """
        raise NotImplementedError

    @abstractmethod
    async def sweep_expired_attempts(
        self,
        *,
        now: Optional[datetime] = None,
    ) -> int:
        """Delete every attempt past its expiry and return how many went."""
        raise NotImplementedError
