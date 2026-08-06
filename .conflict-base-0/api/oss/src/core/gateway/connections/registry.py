from typing import Dict, ItemsView

from oss.src.core.gateway.connections.interfaces import ConnectionsGatewayInterface
from oss.src.core.gateway.connections.exceptions import ProviderNotFoundError


class ConnectionsGatewayRegistry:
    """Dispatches to the correct connection adapter based on provider_key."""

    def __init__(
        self,
        *,
        adapters: Dict[str, ConnectionsGatewayInterface],
    ):
        self._adapters = adapters

    def get(self, provider_key: str) -> ConnectionsGatewayInterface:
        adapter = self._adapters.get(provider_key)
        if not adapter:
            raise ProviderNotFoundError(provider_key)
        return adapter

    def keys(self) -> list[str]:
        return list(self._adapters.keys())

    def items(self) -> ItemsView[str, ConnectionsGatewayInterface]:
        return self._adapters.items()
