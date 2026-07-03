from abc import ABC, abstractmethod
from typing import List, Optional

from oss.src.core.gateway.catalog.dtos import (
    CatalogCategory,
    CatalogIntegration,
    CatalogIntegrationsPage,
    CatalogProvider,
)


class CatalogGatewayInterface(ABC):
    """Port for browsing a provider's catalog (providers + integrations).

    Shared by tools and triggers: both browse the same Composio toolkits. The
    split leaves (actions for tools, events for triggers) are NOT here — each
    domain owns its own leaf adapter.
    """

    @abstractmethod
    async def list_providers(self) -> List[CatalogProvider]: ...

    @abstractmethod
    async def list_integrations(
        self,
        *,
        search: Optional[str] = None,
        sort_by: Optional[str] = None,
        category: Optional[str] = None,
        limit: Optional[int] = None,
        cursor: Optional[str] = None,
    ) -> CatalogIntegrationsPage: ...

    @abstractmethod
    async def list_categories(self) -> List[CatalogCategory]: ...

    @abstractmethod
    async def get_integration(
        self,
        *,
        integration_key: str,
    ) -> Optional[CatalogIntegration]: ...
