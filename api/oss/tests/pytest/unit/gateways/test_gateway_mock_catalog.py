"""Generated development gateway catalogue boundaries (WP28)."""

from oss.src.apis.fastapi.gateways.mcps.proxy import MCPGatewayProxy
from oss.src.core.gateways.dtos import GatewayEndpointNamespace
from oss.src.core.gateways.llms.catalog import (
    builtin_llm_endpoint,
    standard_llm_endpoint,
)
from oss.src.utils.env import env


def test_llm_mock_entries_are_absent_without_the_explicit_switch(monkeypatch):
    monkeypatch.setattr(env.mock_gateways, "enabled", False)

    assert builtin_llm_endpoint(provider_key="agenta") is None
    assert builtin_llm_endpoint(provider_key="mock") is None
    assert standard_llm_endpoint(provider_key="mock") is None


def test_llm_mock_entries_have_distinct_namespaces_profiles_and_owners(monkeypatch):
    monkeypatch.setattr(env.mock_gateways, "enabled", True)

    builtin = builtin_llm_endpoint(provider_key="agenta")
    standard = standard_llm_endpoint(provider_key="mock")

    assert builtin is not None
    assert builtin.namespace == GatewayEndpointNamespace.BUILTIN
    assert builtin.data.route.headers["X-Agenta-Mock-Profile"] == "llm-builtin-agenta"
    assert builtin.data.route.headers["Authorization"].startswith("Bearer ")
    assert standard is not None
    assert standard.namespace == GatewayEndpointNamespace.STANDARD
    assert standard.provider_key == "mock"
    assert standard.data.route.headers["X-Agenta-Mock-Profile"] == "llm-standard-mock"
    assert "Authorization" not in standard.data.route.headers


class _MCPService:
    async def relay(self, **kwargs):  # pragma: no cover - route selection only
        raise AssertionError(kwargs)


def test_mcp_standard_route_uses_standard_namespace():
    proxy = MCPGatewayProxy(mcp_gateway_service=_MCPService())
    route = next(
        route for route in proxy.router.routes if route.path == "/standard/{provider}"
    )

    assert route.endpoint.__name__ == "relay_standard"
    assert "POST" in route.methods
