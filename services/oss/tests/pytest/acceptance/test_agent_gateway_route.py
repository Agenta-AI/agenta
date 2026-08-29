"""Acceptance coverage for harness calls through mock LLM and MCP gateway routes."""

from __future__ import annotations

import os
from uuid import uuid4

import pytest

pytestmark = [pytest.mark.acceptance]

_MOCK_BASE_URL = "http://mock-llm-gateway:9091/v1"
_MOCK_MCP_BASE_URL = "http://mock-mcp-gateway:9092/"
_MOCKS_ENABLED = os.getenv("AGENTA_GATEWAYS_MOCKS_ENABLED", "").lower() == "true"
_MOCK_UPSTREAM_TOKEN = os.getenv("AGENTA_GATEWAYS_MOCKS_UPSTREAM_TOKEN")
_HARNESS_CONNECTIONS = {
    "pi_core": ("openai", "mock/echo"),
    # Codex validates a model against its built-in selectable set before it makes the request.
    # The mock accepts this real Codex id and still replies deterministically.
    "codex": ("openai", "gpt-5.5"),
    # Current Claude Code normalizes its tier alias to this canonical model id before
    # sending the Messages request, so the gateway allow-list must use that exact id.
    "claude": ("anthropic", "claude-sonnet-5"),
}


def _assert_ok(response):
    assert response.status_code == 200, response.text
    return response.json()


@pytest.fixture
def mcp_gateway_connection(request, mod_api):
    """Provision the selected mock MCP route as normal project resources.

    Builtin and standard routes are catalogue entries.  The custom route is an
    ordinary endpoint row with a project-owned secret, exactly as production
    agent configuration uses it.
    """
    namespace = request.param
    if not _MOCKS_ENABLED:
        pytest.skip("gateway mock services are disabled")

    cleanup: list[tuple[str, str]] = []
    try:
        if namespace == "builtin":
            yield {"type": "gateway", "namespace": "builtin", "provider": "mock"}
            return
        if namespace == "standard":
            if not _MOCK_UPSTREAM_TOKEN:
                pytest.skip("AGENTA_GATEWAYS_MOCKS_UPSTREAM_TOKEN is not configured")
            secret = _assert_ok(
                mod_api(
                    "POST",
                    "/secrets/",
                    json={
                        "header": {"name": f"wp33-mock-{uuid4().hex[:8]}"},
                        "secret": {
                            "kind": "provider_key",
                            "data": {
                                "kind": "mock",
                                "provider": {"key": _MOCK_UPSTREAM_TOKEN},
                            },
                        },
                    },
                )
            )
            cleanup.append(("/secrets", secret["id"]))
            yield {"type": "gateway", "namespace": "standard", "provider": "mock"}
            return
        if namespace != "custom":
            raise AssertionError(f"unknown mock MCP namespace: {namespace}")
        if not _MOCK_UPSTREAM_TOKEN:
            pytest.skip("AGENTA_GATEWAYS_MOCKS_UPSTREAM_TOKEN is not configured")
        secret = _assert_ok(
            mod_api(
                "POST",
                "/secrets/",
                json={
                    "header": {"name": f"wp33-mock-{uuid4().hex[:8]}"},
                    "secret": {
                        "kind": "custom_provider",
                        "data": {
                            "kind": "custom",
                            "provider": {"key": _MOCK_UPSTREAM_TOKEN},
                            "models": [],
                        },
                    },
                },
            )
        )
        cleanup.append(("/secrets", secret["id"]))
        slug = f"wp33-mock-mcp-{uuid4().hex[:8]}"
        endpoint = _assert_ok(
            mod_api(
                "POST",
                "/gateways/mcps/endpoints/",
                json={
                    "endpoint": {
                        "slug": slug,
                        "auth_mode": "api_key",
                        "secret_id": secret["id"],
                        "data": {"route": {"base_url": _MOCK_MCP_BASE_URL}},
                    }
                },
            )
        )["endpoint"]
        cleanup.append(("/gateways/mcps/endpoints", endpoint["id"]))
        yield {"type": "gateway", "namespace": "custom", "slug": slug}
    finally:
        for collection, resource_id in reversed(cleanup):
            mod_api("DELETE", f"{collection}/{resource_id}")


@pytest.fixture
def llm_gateway_connection(request, harness, mod_api):
    """Provision the selected mock LLM route as normal project resources."""
    namespace = request.param
    if not _MOCKS_ENABLED:
        pytest.skip("gateway mock services are disabled")

    provider, model = _HARNESS_CONNECTIONS[harness]
    cleanup: list[tuple[str, str]] = []
    try:
        if namespace == "builtin":
            yield {"slug": "mock", "model": model}
            return

        if namespace == "standard":
            if not _MOCK_UPSTREAM_TOKEN:
                pytest.skip("AGENTA_GATEWAYS_MOCKS_UPSTREAM_TOKEN is not configured")
            secret = _assert_ok(
                mod_api(
                    "POST",
                    "/secrets/",
                    json={
                        "header": {"name": f"mock-llm-{uuid4().hex[:8]}"},
                        "secret": {
                            "kind": "provider_key",
                            "data": {
                                "kind": "mock",
                                "provider": {"key": _MOCK_UPSTREAM_TOKEN},
                            },
                        },
                    },
                )
            )
            cleanup.append(("/secrets", secret["id"]))
            yield {"provider": "mock", "model": model}
            return

        if namespace != "custom":
            raise AssertionError(f"unknown mock LLM namespace: {namespace}")

        slug = f"mock-llm-{harness}-{uuid4().hex[:8]}"
        secret = _assert_ok(
            mod_api(
                "POST",
                "/secrets/",
                json={
                    "header": {"name": slug},
                    "secret": {
                        "kind": "custom_provider",
                        "data": {
                            "kind": provider,
                            "provider": {"url": _MOCK_BASE_URL, "key": "sk-mock"},
                            "models": [{"slug": model}],
                        },
                    },
                },
            )
        )
        cleanup.append(("/secrets", secret["id"]))

        endpoint = _assert_ok(
            mod_api(
                "POST",
                "/gateways/llms/endpoints/",
                json={
                    "endpoint": {
                        "slug": slug,
                        "provider_key": provider,
                        "deployment_kind": "custom",
                        "secret_id": None,
                        "data": {
                            "route": {"base_url": _MOCK_BASE_URL},
                            "models": {"allowlist": [model]},
                        },
                    }
                },
            )
        )["endpoint"]
        cleanup.append(("/gateways/llms/endpoints", endpoint["id"]))
        yield {"slug": slug, "model": model}
    finally:
        for collection, resource_id in reversed(cleanup):
            mod_api("DELETE", f"{collection}/{resource_id}")


@pytest.mark.parametrize(
    "harness",
    ["pi_core", "codex", "claude"],
)
@pytest.mark.slow
@pytest.mark.xdist_group(name="agent-gateway-mock-matrix")
@pytest.mark.parametrize(
    "llm_gateway_connection", ["builtin", "standard", "custom"], indirect=True
)
@pytest.mark.parametrize(
    "mcp_gateway_connection", ["builtin", "standard", "custom"], indirect=True
)
def test_agent_harness_calls_echo_through_each_mock_mcp_gateway_route(
    harness, llm_gateway_connection, mcp_gateway_connection, mod_services_api
):
    """The real service -> runner -> harness path calls a gateway-backed mock MCP tool."""
    marker = f"MCP-ACCEPTANCE-{harness}-{uuid4().hex[:12]}"
    resp = mod_services_api(
        "POST",
        "/agent/v0/invoke",
        timeout=180,
        json={
            "data": {
                "inputs": {
                    "messages": [
                        {
                            "role": "user",
                            "content": (
                                f"Use the echo tool with marker {marker}, then state its result."
                            ),
                        }
                    ]
                },
                "parameters": {
                    "agent": {
                        "harness": {"kind": harness},
                        "llm": {
                            "model": llm_gateway_connection["model"],
                            **(
                                {"provider": llm_gateway_connection["provider"]}
                                if "provider" in llm_gateway_connection
                                else {
                                    "connection": {
                                        "mode": "agenta",
                                        "slug": llm_gateway_connection["slug"],
                                    }
                                }
                            ),
                        },
                        "mcps": [
                            {
                                "name": "mock-mcp",
                                "connection": mcp_gateway_connection,
                                "policy": {"permission": "allow"},
                            }
                        ],
                    }
                },
            },
        },
    )

    body = _assert_ok(resp)
    messages = body["data"]["outputs"]["messages"]
    assert messages, "expected at least one assistant message"
    assert messages[-1]["role"] == "assistant", messages
    # This exact response is emitted only after the mock model receives a successful echo
    # result; it proves discovery and invocation rather than merely prompt echoing.
    assert messages[-1]["content"] == f"mock MCP echo: {marker}", body
