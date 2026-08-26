from abc import ABC, abstractmethod
from typing import List, Optional

from oss.src.core.tools.dtos import (
    ToolCatalogAction,
    ToolCatalogActionDetails,
    ToolCatalogActionsPage,
    ToolCatalogIntegration,
    ToolCatalogIntegrationsPage,
    ToolCatalogProvider,
    ToolExecutionRequest,
    ToolExecutionResponse,
)

# The search result keeps its provider-shaped model: it is the only search
# implementation, and the whole discovery pipeline is typed on it. A neutral
# shape would be a translation layer with one caller on each side.
from oss.src.core.tools.providers.composio.dtos import ComposioSearchResult


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
    async def list_all_actions(
        self,
        *,
        integration_key: str,
    ) -> List[ToolCatalogAction]:
        """Fetch one integration's whole catalog, following the cursor to exhaustion.

        The provider owns its page size and cursor rules. A crawl that cannot finish
        must raise rather than return a partial catalog, which the caller would cache.
        """
        ...

    @abstractmethod
    async def get_action(
        self,
        *,
        action_key: str,
        provider_action_id: str,
    ) -> Optional[ToolCatalogActionDetails]:
        """Fetch one action's detail by the provider's own action ID.

        ``action_key`` is echoed back as the Agenta key; the provider is addressed
        only through ``provider_action_id``, which comes from the catalog.
        """
        ...

    @abstractmethod
    async def execute(
        self,
        *,
        request: ToolExecutionRequest,
    ) -> ToolExecutionResponse:
        """Execute a tool action."""
        ...

    @abstractmethod
    async def search_capabilities(
        self,
        *,
        use_cases: List[str],
        user_id: str,
        toolkits: Optional[List[str]] = None,
    ) -> ComposioSearchResult:
        """Search the provider's catalog semantically.

        On the port rather than reached by attribute lookup, so a provider that cannot
        search fails when its class is built instead of on a live agent turn.
        ``toolkits`` scopes the search to those integrations natively.
        """
        ...
