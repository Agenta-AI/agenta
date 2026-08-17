"""`MCPUpstreamRegistry` — adapter-key dispatch for the MCP south port (entities.md §7.1).

Shape copied verbatim from `ConnectionsGatewayRegistry`
(`core/gateway/connections/registry.py`) per specs-wp9.md: the fourth structurally
identical registry in this codebase. `core/gateways/mcps/interfaces.py` declares only the DAO
interfaces and the south port — entities.md §7.1 shows the registry in the same code
fence, which is presentation, not placement (R13). This module is where it lives.
"""

from typing import Dict

from oss.src.core.gateways.mcps.interfaces import MCPUpstreamInterface
from oss.src.core.gateways.mcps.types import MCPUpstreamError


class MCPUpstreamRegistry:
    def __init__(self, *, adapters: Dict[str, MCPUpstreamInterface]) -> None:
        self._adapters = adapters

    def get(self, key: str) -> MCPUpstreamInterface:
        adapter = self._adapters.get(key)
        if adapter is None:
            # No dedicated registry-miss exception is named by entities.md §7.1
            # (specs-wp9.md, "Missing from the design") — MCPUpstreamError repurposed
            # with `target` naming the missing key rather than a URL.
            raise MCPUpstreamError(
                target=key, detail=f"no upstream adapter registered for {key!r}"
            )
        return adapter

    def keys(self) -> list[str]:
        return list(self._adapters.keys())
