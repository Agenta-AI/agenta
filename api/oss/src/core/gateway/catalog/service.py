"""Shared catalog service — providers + integrations for tools AND triggers.

Both domains browse the same provider catalog (Composio toolkits), so the read
logic lives here once and each router calls it. The leaf reads (tool actions /
trigger events) stay in their own domain services.
"""

from typing import List, Optional, Tuple

from oss.src.core.gateway.catalog.dtos import (
    CatalogIntegration,
    CatalogProvider,
)
from oss.src.core.gateway.catalog.registry import CatalogGatewayRegistry


class CatalogService:
    def __init__(
        self,
        *,
        adapter_registry: CatalogGatewayRegistry,
    ):
        self.adapter_registry = adapter_registry

    async def list_providers(self) -> List[CatalogProvider]:
        results: List[CatalogProvider] = []
        for _key, adapter in self.adapter_registry.items():
            providers = await adapter.list_providers()
            results.extend(providers)
        return results

    async def get_provider(
        self,
        *,
        provider_key: str,
    ) -> Optional[CatalogProvider]:
        adapter = self.adapter_registry.get(provider_key)
        providers = await adapter.list_providers()
        for p in providers:
            if p.key == provider_key:
                return p
        return None

    async def list_integrations(
        self,
        *,
        provider_key: str,
        #
        search: Optional[str] = None,
        sort_by: Optional[str] = None,
        limit: Optional[int] = None,
        cursor: Optional[str] = None,
    ) -> Tuple[List[CatalogIntegration], Optional[str], int]:
        adapter = self.adapter_registry.get(provider_key)
        return await adapter.list_integrations(
            search=search,
            sort_by=sort_by,
            limit=limit,
            cursor=cursor,
        )

    async def get_integration(
        self,
        *,
        provider_key: str,
        integration_key: str,
    ) -> Optional[CatalogIntegration]:
        adapter = self.adapter_registry.get(provider_key)
        return await adapter.get_integration(integration_key=integration_key)
