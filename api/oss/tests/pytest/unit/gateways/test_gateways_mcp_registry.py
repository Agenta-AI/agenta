"""Unit tests for `McpUpstreamRegistry` (specs-wp9.md, tasks-wp9.md).

Shape mirrors `ConnectionsGatewayRegistry`: two fake adapters registered, `get()` returns
the right one and raises on a miss, `keys()` lists exactly the registered set.
"""

import pytest

from oss.src.core.gateways.mcps.dtos import (
    McpCallContext,
    McpRelayAuth,
    McpResolvedRoute,
)
from oss.src.core.gateways.mcps.interfaces import McpRelayResult, McpUpstreamInterface
from oss.src.core.gateways.mcps.registry import McpUpstreamRegistry
from oss.src.core.gateways.mcps.types import McpUpstreamError


class _FakeAdapter(McpUpstreamInterface):
    def __init__(self, name: str) -> None:
        self.name = name

    async def relay(
        self,
        *,
        route: McpResolvedRoute,
        auth: McpRelayAuth,
        context: McpCallContext,
        body: bytes,
        headers: dict,
    ) -> McpRelayResult:
        return McpRelayResult(status_code=200, headers={}, body=self.name.encode())


def test_get_returns_the_registered_adapter():
    fake = _FakeAdapter("fake")
    http = _FakeAdapter("http")
    registry = McpUpstreamRegistry(adapters={"fake": fake, "http": http})

    assert registry.get("fake") is fake
    assert registry.get("http") is http


def test_get_on_missing_key_raises_mcp_upstream_error():
    registry = McpUpstreamRegistry(adapters={"fake": _FakeAdapter("fake")})

    with pytest.raises(McpUpstreamError) as excinfo:
        registry.get("composio")

    assert excinfo.value.target == "composio"


def test_keys_returns_exactly_the_registered_set():
    registry = McpUpstreamRegistry(
        adapters={"fake": _FakeAdapter("fake"), "http": _FakeAdapter("http")}
    )

    assert set(registry.keys()) == {"fake", "http"}
