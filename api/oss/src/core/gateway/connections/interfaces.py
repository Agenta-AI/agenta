from abc import ABC, abstractmethod
from typing import Any, Dict, List, Optional
from uuid import UUID

from oss.src.core.gateway.connections.dtos import (
    Connection,
    ConnectionCreate,
    ConnectionRequest,
    ConnectionResponse,
)


class ConnectionsDAOInterface(ABC):
    """Connection persistence contract — owns the gateway_connections table."""

    @abstractmethod
    async def create_connection(
        self,
        *,
        project_id: UUID,
        user_id: UUID,
        #
        connection_create: ConnectionCreate,
    ) -> Optional[Connection]: ...

    @abstractmethod
    async def get_connection(
        self,
        *,
        project_id: UUID,
        connection_id: UUID,
    ) -> Optional[Connection]: ...

    @abstractmethod
    async def update_connection(
        self,
        *,
        project_id: UUID,
        connection_id: UUID,
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
        project_id: UUID,
        connection_id: UUID,
    ) -> bool: ...

    @abstractmethod
    async def query_connections(
        self,
        *,
        project_id: UUID,
        #
        provider_key: Optional[str] = None,
        integration_key: Optional[str] = None,
        is_active: Optional[bool] = True,
    ) -> List[Connection]: ...

    @abstractmethod
    async def find_connection_by_provider_id(
        self,
        *,
        provider_connection_id: str,
    ) -> Optional[Connection]: ...

    @abstractmethod
    async def activate_connection_by_provider_id(
        self,
        *,
        provider_connection_id: str,
        project_id: Optional[UUID] = None,
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
    ) -> Dict[str, Any]:
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
    ) -> Dict[str, Any]: ...

    @abstractmethod
    async def revoke_connection(
        self,
        *,
        provider_connection_id: str,
    ) -> bool: ...
