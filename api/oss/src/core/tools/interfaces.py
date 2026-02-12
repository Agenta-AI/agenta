from abc import ABC, abstractmethod
from typing import Any, Dict, List, Optional
from uuid import UUID

from oss.src.core.tools.dtos import (
    CatalogAction,
    CatalogIntegration,
    CatalogProvider,
    Connection,
    ConnectionCreate,
    ExecutionResult,
    Tags,
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
        provider_key: str,
        integration_key: str,
        #
        connection_create: ConnectionCreate,
        #
        provider_connection_id: Optional[str] = None,
        auth_config_id: Optional[str] = None,
    ) -> Optional[Connection]: ...

    @abstractmethod
    async def get_connection(
        self,
        *,
        project_id: UUID,
        #
        provider_key: str,
        integration_key: str,
        connection_slug: str,
    ) -> Optional[Connection]: ...

    @abstractmethod
    async def update_connection(
        self,
        *,
        project_id: UUID,
        #
        provider_key: str,
        integration_key: str,
        connection_slug: str,
        #
        is_valid: Optional[bool] = None,
        is_active: Optional[bool] = None,
        status: Optional[str] = None,
        provider_connection_id: Optional[str] = None,
    ) -> Optional[Connection]: ...

    @abstractmethod
    async def delete_connection(
        self,
        *,
        project_id: UUID,
        #
        provider_key: str,
        integration_key: str,
        connection_slug: str,
    ) -> bool: ...

    @abstractmethod
    async def query_connections(
        self,
        *,
        project_id: UUID,
        #
        provider_key: Optional[str] = None,
        integration_key: Optional[str] = None,
    ) -> List[Connection]: ...


class GatewayAdapterInterface(ABC):
    """Port for external tool providers (Composio, Agenta, etc.)."""

    @abstractmethod
    async def list_providers(self) -> List[CatalogProvider]: ...

    @abstractmethod
    async def list_integrations(
        self,
        *,
        search: Optional[str] = None,
        limit: Optional[int] = None,
    ) -> List[CatalogIntegration]: ...

    @abstractmethod
    async def list_actions(
        self,
        *,
        integration_key: str,
        search: Optional[str] = None,
        tags: Optional[Tags] = None,
        important: Optional[bool] = None,
        limit: Optional[int] = None,
    ) -> List[CatalogAction]: ...

    @abstractmethod
    async def get_action(
        self,
        *,
        integration_key: str,
        action_key: str,
    ) -> Optional[CatalogAction]: ...

    @abstractmethod
    async def initiate_connection(
        self,
        *,
        entity_id: str,
        integration_key: str,
        callback_url: Optional[str] = None,
    ) -> Dict[str, Any]:
        """Returns provider-side { id, redirect_url }."""
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
        integration_key: str,
        action_key: str,
        provider_connection_id: str,
        arguments: Dict[str, Any],
    ) -> ExecutionResult:
        """Execute a tool action."""
        ...
