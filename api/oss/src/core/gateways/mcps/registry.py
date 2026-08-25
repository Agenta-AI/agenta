"""MCP relay adapter registry."""

from typing import Dict

from oss.src.core.gateways.mcps.interfaces import MCPUpstreamInterface
from oss.src.core.gateways.mcps.types import MCPUpstreamError


class MCPUpstreamRegistry:
    def __init__(self, *, adapters: Dict[str, MCPUpstreamInterface]) -> None:
        self._adapters = adapters

    def get(self, key: str) -> MCPUpstreamInterface:
        adapter = self._adapters.get(key)
        if adapter is None:
            raise MCPUpstreamError(
                target=key, detail=f"no upstream adapter registered for {key!r}"
            )
        return adapter

    def keys(self) -> list[str]:
        return list(self._adapters.keys())
