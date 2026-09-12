"""The composition entrypoints: resolve_tools / resolve_mcp."""

from __future__ import annotations

from typing import Mapping, Sequence

from agenta.sdk.agents.platform import PlatformConnection, resolve_tools
from agenta.sdk.agents.platform import resolve_mcp


class _EmptySecrets:
    async def get_many(self, names: Sequence[str]) -> Mapping[str, str]:
        return {}


class _ExplodingGateway:
    async def resolve(self, tools):
        raise AssertionError(
            "gateway resolver must not be called without gateway tools"
        )


async def test_resolve_tools_skips_gateway_without_gateway_tools():
    # No gateway tool ⇒ the gateway resolver (and its HTTP) is never touched. An exploding
    # resolver proves the short-circuit: resolution completes without invoking it.
    resolved = await resolve_tools(
        ["read", {"type": "client", "name": "pick"}],
        secret_provider=_EmptySecrets(),
        gateway_resolver=_ExplodingGateway(),
    )
    assert {spec.name for spec in resolved.tool_specs} == {"pick"}


async def test_resolve_mcp_empty_returns_empty():
    assert await resolve_mcp([], secret_provider=_EmptySecrets()) == []


async def test_resolve_mcp_routes_through_the_gateway_when_configured():
    # `resolve_mcp` is the connected default: with a backend configured, every
    # server routes through `custom/{name}` with our credentials rather than dialling the
    # author's own URL with a named secret — `_EmptySecrets` proves no vault lookup happens.
    connection = PlatformConnection(
        base_url="https://api.x/api", authorization="Access tok"
    )
    resolved = await resolve_mcp(
        [
            {
                "name": "notion",
                "connection": {"type": "http", "url": "https://93.184.216.34/mcp"},
            }
        ],
        secret_provider=_EmptySecrets(),
        connection=connection,
    )
    assert len(resolved) == 1
    assert resolved[0].url == "https://api.x/api/gateways/mcps/custom/notion"
    assert [c.binding.name for c in resolved[0].credentials] == ["X-AG-Credentials"]


async def test_resolve_mcp_selects_a_platform_mcp_route_when_declared():
    connection = PlatformConnection(
        base_url="https://api.x/api", authorization="Access tok"
    )
    resolved = await resolve_mcp(
        [
            {
                "name": "mock-tools",
                "connection": {
                    "type": "gateway",
                    "namespace": "standard",
                    "provider": "mock",
                },
            }
        ],
        secret_provider=_EmptySecrets(),
        connection=connection,
    )
    assert resolved[0].url == "https://api.x/api/gateways/mcps/standard/mock"
    assert [c.binding.name for c in resolved[0].credentials] == ["X-AG-Credentials"]
