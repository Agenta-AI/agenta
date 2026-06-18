from typing import Dict, ItemsView

from oss.src.core.triggers.interfaces import TriggersGatewayInterface
from oss.src.core.triggers.exceptions import ProviderNotFoundError


class TriggersGatewayRegistry:
    """Dispatches to the correct adapter based on provider_key."""

    def __init__(
        self,
        *,
        adapters: Dict[str, TriggersGatewayInterface],
    ):
        self._adapters = adapters

    def get(self, provider_key: str) -> TriggersGatewayInterface:
        adapter = self._adapters.get(provider_key)
        if not adapter:
            raise ProviderNotFoundError(provider_key)
        return adapter

    def keys(self) -> list[str]:
        return list(self._adapters.keys())

    def items(self) -> ItemsView[str, TriggersGatewayInterface]:
        return self._adapters.items()
