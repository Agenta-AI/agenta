"""Unit tests for `MCPUpstreamRegistry`.

Shape mirrors `ConnectionsGatewayRegistry`: two mock adapters registered, `get()` returns
the right one and raises on a miss, `keys()` lists exactly the registered set.
"""

import pytest

from oss.src.core.gateways.mcps.dtos import (
    MCPCallContext,
    MCPRelayAuth,
    MCPResolvedRoute,
)
from oss.src.core.gateways.mcps.interfaces import MCPRelayResult, MCPUpstreamInterface
from oss.src.core.gateways.mcps.registry import MCPUpstreamRegistry
from oss.src.core.gateways.mcps.types import MCPUpstreamError


class _MockAdapter(MCPUpstreamInterface):
    def __init__(self, name: str) -> None:
        self.name = name

    async def relay(
        self,
        *,
        route: MCPResolvedRoute,
        auth: MCPRelayAuth,
        context: MCPCallContext,
        body: bytes,
        headers: dict,
    ) -> MCPRelayResult:
        return MCPRelayResult(status_code=200, headers={}, body=self.name.encode())


def test_get_returns_the_registered_adapter():
    mock = _MockAdapter("mock")
    http = _MockAdapter("http")
    registry = MCPUpstreamRegistry(adapters={"mock": mock, "http": http})

    assert registry.get("mock") is mock
    assert registry.get("http") is http


def test_get_on_missing_key_raises_mcp_upstream_error():
    registry = MCPUpstreamRegistry(adapters={"mock": _MockAdapter("mock")})

    with pytest.raises(MCPUpstreamError) as excinfo:
        registry.get("composio")

    assert excinfo.value.target == "composio"


def test_keys_returns_exactly_the_registered_set():
    registry = MCPUpstreamRegistry(
        adapters={"mock": _MockAdapter("mock"), "http": _MockAdapter("http")}
    )

    assert set(registry.keys()) == {"mock", "http"}
