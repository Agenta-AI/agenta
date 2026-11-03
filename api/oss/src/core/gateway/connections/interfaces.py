from abc import ABC, abstractmethod
from typing import Any, Dict, List, Optional
from uuid import UUID

from oss.src.core.secrets.dtos import SecretOwner
from oss.src.core.gateway.connections.dtos import (
    Connection,
    ConnectionCreate,
    ConnectionRefreshResponse,
    ConnectionRequest,
    ConnectionResponse,
    ConnectionStatusResponse,
)


class ConnectionsDAOInterface(ABC):
    """Connection persistence contract — owns the gateway_connections table."""

    @abstractmethod
    async def create_connection(
        self,
        *,
        project_id: Optional[UUID],
        user_id: UUID,
        #
        connection_create: ConnectionCreate,
        owner: Optional[SecretOwner] = None,
    ) -> Optional[Connection]: ...

    # Every method that takes `owner` addresses a person's own rows when it is set (then
    # `project_id` is not read), and the project's rows otherwise.

    @abstractmethod
    async def get_connection(
        self,
        *,
        project_id: Optional[UUID],
        connection_id: UUID,
        owner: Optional[SecretOwner] = None,
    ) -> Optional[Connection]: ...

    @abstractmethod
    async def update_connection(
        self,
        *,
        project_id: Optional[UUID],
        connection_id: UUID,
        owner: Optional[SecretOwner] = None,
        #
        is_valid: Optional[bool] = None,
        is_active: Optional[bool] = None,
        provider_connection_id: Optional[str] = None,
        data_update: Optional[Dict[str, Any]] = None,
    ) -> Optional[Connection]: ...

    @abstractmethod
    async def delete_connection(
        self,
        *,
        project_id: Optional[UUID],
        connection_id: UUID,
        owner: Optional[SecretOwner] = None,
    ) -> bool: ...

    @abstractmethod
    async def query_connections(
        self,
        *,
        project_id: Optional[UUID],
        #
        provider_key: Optional[str] = None,
        integration_key: Optional[str] = None,
        is_active: Optional[bool] = True,
        owner: Optional[SecretOwner] = None,
    ) -> List[Connection]: ...

    @abstractmethod
    async def find_connection_by_provider_id(
        self,
        *,
        project_id: UUID,
        provider_connection_id: str,
    ) -> Optional[Connection]: ...

    @abstractmethod
    async def activate_connection_by_provider_id(
        self,
        *,
        project_id: Optional[UUID],
        provider_connection_id: str,
        owner: Optional[SecretOwner] = None,
    ) -> Optional[Connection]: ...

    # -- a person's own connections: always by the person AND the organization.

    @abstractmethod
    async def delete_personal_connections(self, *, owner: SecretOwner) -> int: ...

    @abstractmethod
    async def make_default(
        self, *, owner: SecretOwner, connection_id: UUID
    ) -> Optional[Connection]: ...


class ConnectionsGatewayInterface(ABC):
    """Adapter port for external connection providers (Composio, Agenta, etc.).

    Provider-keyed on ``provider_connection_id`` and returns provider data.
    Holds only the auth verbs; tool-specific verbs (execute, catalog) stay on
    ``ToolsGatewayInterface``.
    """

    @abstractmethod
    async def initiate_connection(
        self,
        *,
        request: ConnectionRequest,
    ) -> ConnectionResponse:
        """Initiate a provider-side connection. Returns a typed response with
        provider_connection_id, redirect_url, and connection_data — the dict
        the service will persist in the local connection record.
        """
        ...

    @abstractmethod
    async def get_connection_status(
        self,
        *,
        provider_connection_id: str,
    ) -> ConnectionStatusResponse:
        """Poll provider for updated connection status."""
        ...

    @abstractmethod
    async def refresh_connection(
        self,
        *,
        provider_connection_id: str,
        force: bool = False,
        callback_url: Optional[str] = None,
        integration_key: Optional[str] = None,
        user_id: Optional[str] = None,
        auth_scheme: Optional[str] = None,
    ) -> ConnectionRefreshResponse: ...

    @abstractmethod
    async def revoke_connection(
        self,
        *,
        provider_connection_id: str,
    ) -> bool: ...
