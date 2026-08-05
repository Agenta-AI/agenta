from abc import ABC, abstractmethod
from typing import List, Optional

from oss.src.core.tools.dtos import (
    ToolCatalogActionDetails,
    ToolCatalogActionsPage,
    ToolCatalogIntegration,
    ToolCatalogIntegrationsPage,
    ToolCatalogProvider,
    ToolExecutionRequest,
    ToolExecutionResponse,
)


class ToolsGatewayInterface(ABC):
    """Port for external tool providers (Composio, Agenta, etc.).

    Tool-specific verbs only — catalog browse and execution. Connection auth
    verbs live behind ``ConnectionsGatewayInterface`` in the connections domain.
    """

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
    ) -> ToolCatalogIntegrationsPage: ...

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
    ) -> ToolCatalogActionsPage: ...

    @abstractmethod
    async def get_action(
        self,
        *,
        integration_key: str,
        action_key: str,
    ) -> Optional[ToolCatalogActionDetails]: ...

    @abstractmethod
    async def execute(
        self,
        *,
        request: ToolExecutionRequest,
    ) -> ToolExecutionResponse:
        """Execute a tool action."""
        ...
