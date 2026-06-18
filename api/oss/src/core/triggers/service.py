from typing import List, Optional, Tuple

from oss.src.utils.logging import get_module_logger

from oss.src.core.triggers.dtos import (
    TriggerCatalogEvent,
    TriggerCatalogEventDetails,
    TriggerCatalogProvider,
)
from oss.src.core.triggers.registry import TriggersGatewayRegistry


log = get_module_logger(__name__)


class TriggersService:
    """Triggers domain orchestration.

    WP1 scope is the read-only events catalog. Subscriptions/deliveries CRUD and
    ingress/dispatch land in later WPs (WP3/WP4) and will extend this service.
    """

    def __init__(
        self,
        *,
        adapter_registry: TriggersGatewayRegistry,
    ):
        self.adapter_registry = adapter_registry

    # -----------------------------------------------------------------------
    # Catalog browse
    # -----------------------------------------------------------------------

    async def list_providers(self) -> List[TriggerCatalogProvider]:
        """Return all providers across registered adapters."""
        results: List[TriggerCatalogProvider] = []
        for _key, adapter in self.adapter_registry.items():
            providers = await adapter.list_providers()
            results.extend(providers)
        return results

    async def get_provider(
        self,
        *,
        provider_key: str,
    ) -> Optional[TriggerCatalogProvider]:
        """Return a single provider by key, or None if not found."""
        adapter = self.adapter_registry.get(provider_key)
        providers = await adapter.list_providers()
        for p in providers:
            if p.key == provider_key:
                return p
        return None

    async def list_events(
        self,
        *,
        provider_key: str,
        integration_key: str,
        #
        query: Optional[str] = None,
        limit: Optional[int] = None,
        cursor: Optional[str] = None,
    ) -> Tuple[List[TriggerCatalogEvent], Optional[str], int]:
        """List events for an integration with optional search and pagination."""
        adapter = self.adapter_registry.get(provider_key)
        return await adapter.list_events(
            integration_key=integration_key,
            query=query,
            limit=limit,
            cursor=cursor,
        )

    async def get_event(
        self,
        *,
        provider_key: str,
        integration_key: str,
        event_key: str,
    ) -> Optional[TriggerCatalogEventDetails]:
        """Return full event detail including its trigger_config schema, or None."""
        adapter = self.adapter_registry.get(provider_key)
        return await adapter.get_event(
            integration_key=integration_key,
            event_key=event_key,
        )
