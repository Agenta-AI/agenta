"""Interfaces for MCP OAuth: attempt persistence, and grant refresh."""

from abc import ABC, abstractmethod
from datetime import datetime
from typing import Optional
from uuid import UUID

from oss.src.core.gateways.mcps.oauth.dtos import (
    MCPOAuthAttempt,
    MCPOAuthAttemptCreate,
)


class MCPOAuthRefresherInterface(ABC):
    """Exchange a stored refresh token for a fresh grant.

    The data plane needs this and owns none of it: the tokens live in the vault and the
    exchange is an OAuth call. Stating it as an interface keeps `MCPGatewayService`
    unaware of the connect service, which in turn depends on the vault and the OAuth
    client.
    """

    @abstractmethod
    async def refresh_grant(self, *, project_id: UUID, server_url: str) -> None:
        """Refresh the stored grant for one server, in place.

        Returns nothing: the caller re-reads the secret it already holds a reference to,
        because the refreshed tokens are written back to that same row. Raises
        `MCPOAuthRefreshFailedError` when no usable grant can be produced.
        """
        raise NotImplementedError


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
    async def consume_attempt(
        self,
        *,
        state: str,
    ) -> Optional[MCPOAuthAttempt]:
        """Remove the attempt and return it, in one statement.

        Exactly one caller can be handed a given record: the second concurrent
        consumer's statement matches no row and gets `None`. Expiry is NOT applied
        here — an expired record is still consumed, and the caller decides what to
        say about it — so an expired handle cannot be probed repeatedly either.
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
