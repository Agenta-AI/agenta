"""Generated development gateway catalogue boundaries (WP28)."""

from oss.src.apis.fastapi.gateways.mcps.proxy import MCPGatewayProxy
from oss.src.core.gateways.dtos import GatewayEndpointNamespace
from oss.src.core.gateways.llms.catalog import (
    builtin_llm_endpoint,
    standard_llm_endpoint,
)
from oss.src.core.gateways.llms.dtos import LLMDeploymentKind
from oss.src.utils.env import env


def test_llm_mock_entries_are_absent_without_the_explicit_switch(monkeypatch):
    monkeypatch.setattr(env.mock_gateways, "enabled", False)

    assert builtin_llm_endpoint(provider_key="agenta") is None
    assert builtin_llm_endpoint(provider_key="mock") is None
    assert standard_llm_endpoint(provider_key="mock") is None


def test_llm_mock_entries_have_distinct_namespaces_and_use_mock_adapter(monkeypatch):
    monkeypatch.setattr(env.mock_gateways, "enabled", True)

    builtin = builtin_llm_endpoint(provider_key="agenta")
    standard = standard_llm_endpoint(provider_key="mock")

    assert builtin is not None
    assert builtin.namespace == GatewayEndpointNamespace.BUILTIN
    assert builtin.deployment_kind is LLMDeploymentKind.MOCK
    assert builtin.data.route.base_url is None
    assert builtin.data.route.headers is None
    assert set(builtin.data.models.allowlist or []) == {
        "mock/echo",
        "gpt-5.5",
        "claude-sonnet-5",
    }
    assert standard is not None
    assert standard.namespace == GatewayEndpointNamespace.STANDARD
    assert standard.provider_key == "mock"
    assert standard.deployment_kind is LLMDeploymentKind.MOCK
    assert standard.data.route.base_url is None
    assert standard.data.route.headers is None
    assert standard.data.models.allowlist == builtin.data.models.allowlist


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
