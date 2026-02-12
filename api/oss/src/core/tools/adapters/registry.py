from typing import Dict, ItemsView

from oss.src.core.tools.interfaces import GatewayAdapterInterface
from oss.src.core.tools.exceptions import ProviderNotFoundError


class GatewayAdapterRegistry:
    """Dispatches to the correct adapter based on provider_key."""

    def __init__(
        self,
        *,
        adapters: Dict[str, GatewayAdapterInterface],
    ):
        self._adapters = adapters

    def get(self, provider_key: str) -> GatewayAdapterInterface:
        adapter = self._adapters.get(provider_key)
        if not adapter:
            raise ProviderNotFoundError(provider_key)
        return adapter

    def keys(self) -> list[str]:
        return list(self._adapters.keys())

    def items(self) -> ItemsView[str, GatewayAdapterInterface]:
        return self._adapters.items()
