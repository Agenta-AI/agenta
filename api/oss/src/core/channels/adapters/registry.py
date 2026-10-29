from typing import Dict, ItemsView, List

from oss.src.core.channels.adapters.interface import ChannelAdapterInterface
from oss.src.core.channels.types import ChannelNotSupported


class ChannelAdapterRegistry:
    """Dispatches to the correct adapter based on channel key. Mirrors
    TriggersGatewayRegistry: same three methods, raise-on-miss, never None."""

    def __init__(self, *, adapters: Dict[str, ChannelAdapterInterface]) -> None:
        self._adapters = adapters

    def get(self, channel: str) -> ChannelAdapterInterface:
        adapter = self._adapters.get(channel)
        if adapter is None:
            raise ChannelNotSupported(channel=channel)
        return adapter

    def keys(self) -> List[str]:
        return list(self._adapters.keys())

    def items(self) -> ItemsView[str, ChannelAdapterInterface]:
        return self._adapters.items()
