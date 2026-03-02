from abc import ABC, abstractmethod
from typing import Any, Dict, List, Optional, Tuple
from uuid import UUID

from oss.src.core.tools.dtos import (
    ToolCatalogAction,
    ToolCatalogActionDetails,
    ToolCatalogIntegration,
    ToolCatalogProvider,
    ToolConnection,
    ToolConnectionCreate,
    ToolConnectionRequest,
    ToolConnectionResponse,
    ToolExecutionRequest,
    ToolExecutionResponse,
)


class ToolsDAOInterface(ABC):
    """Connection persistence contract."""

    @abstractmethod
    async def create_connection(
        self,
        *,
        project_id: UUID,
        user_id: UUID,
        #
        connection_create: ToolConnectionCreate,
    ) -> Optional[ToolConnection]: ...

    @abstractmethod
    async def get_connection(
        self,
        *,
        project_id: UUID,
        connection_id: UUID,
    ) -> Optional[ToolConnection]: ...

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
    ) -> Optional[ToolConnection]: ...

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
    ) -> List[ToolConnection]: ...

    @abstractmethod
    async def find_connection_by_provider_id(
        self,
        *,
        provider_connection_id: str,
    ) -> Optional[ToolConnection]: ...

    @abstractmethod
    async def activate_connection_by_provider_id(
        self,
        *,
        provider_connection_id: str,
        project_id: Optional[UUID] = None,
    ) -> Optional[ToolConnection]: ...


class ToolsGatewayInterface(ABC):
    """Port for external tool providers (Composio, Agenta, etc.)."""

    @abstractmethod
    async def list_providers(self) -> List[ToolCatalogProvider]: ...

    @abstractmethod
    async def list_integrations(
        self,
        *,
        search: Optional[str] = None,
        sort_by: Optional[str] = None,
        limit: Optional[int] = None,
        cursor: Optional[str] = None,
    ) -> Tuple[List[ToolCatalogIntegration], Optional[str], int]:
        """Returns (items, next_cursor, total_items)."""
        ...

    @abstractmethod
    async def get_integration(
        self,
        *,
        integration_key: str,
    ) -> Optional[ToolCatalogIntegration]: ...

    @abstractmethod
    async def list_actions(
        self,
        *,
        integration_key: str,
        query: Optional[str] = None,
        categories: Optional[List[str]] = None,
        important: Optional[bool] = None,
        limit: Optional[int] = None,
        cursor: Optional[str] = None,
    ) -> Tuple[List[ToolCatalogAction], Optional[str], int]:
        """Returns (items, next_cursor, total_items)."""
        ...

    @abstractmethod
    async def get_action(
        self,
        *,
        integration_key: str,
        action_key: str,
    ) -> Optional[ToolCatalogActionDetails]: ...

    @abstractmethod
    async def initiate_connection(
        self,
        *,
        request: ToolConnectionRequest,
    ) -> ToolConnectionResponse:
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

    @abstractmethod
    async def execute(
        self,
        *,
        request: ToolExecutionRequest,
    ) -> ToolExecutionResponse:
        """Execute a tool action."""
        ...
