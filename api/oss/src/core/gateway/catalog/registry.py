from typing import Dict, ItemsView

from oss.src.core.gateway.catalog.interfaces import CatalogGatewayInterface
from oss.src.core.gateway.connections.exceptions import ProviderNotFoundError


class CatalogGatewayRegistry:
    """Dispatches to the correct catalog adapter based on provider_key."""

    def __init__(
        self,
        *,
        adapters: Dict[str, CatalogGatewayInterface],
    ):
        self._adapters = adapters

    def get(self, provider_key: str) -> CatalogGatewayInterface:
        adapter = self._adapters.get(provider_key)
        if not adapter:
            raise ProviderNotFoundError(provider_key)
        return adapter

    def keys(self) -> list[str]:
        return list(self._adapters.keys())

    def items(self) -> ItemsView[str, CatalogGatewayInterface]:
        return self._adapters.items()
