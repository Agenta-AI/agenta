"""Acceptance: agent v0's model call goes through the gateway (specs-wp14.md).

WRITTEN, NOT RUN by this package (`api/AGENTS.md` testing rules: acceptance needs a real
deployment, and this worktree carries none). Depends on WP5's `mock-llm-gateway` and WP7's
gateway service, same as `api/oss/tests/pytest/acceptance/gateways/
test_llm_gateway_proxy_acceptance.py`; collection succeeds today, execution needs that M2
deployment. Run manually once it exists:

    load-env hosting/docker-compose/oss/.env.oss.dev
    bash hosting/docker-compose/run.sh --oss --dev --build
    cd services/oss && py-run-tests  # or: pytest oss/tests/pytest/acceptance -m acceptance

Proves the contract in specs-wp14.md: the agent resolves a `custom_provider` vault
connection into a `custom/{slug}` gateway route and reaches the mock upstream through it —
no direct socket to a provider, no provider secret in the request. The audit-event half of
the acceptance criterion ("its calls appear as audit events with the right principal",
launch-2.md) is not asserted here: WP4 owns emission and has no HTTP query surface on this
branch yet. Extend this test once that surface lands.
"""

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
def mock_custom_connection(harness, mod_api):
    """A `custom_provider` vault secret and a matching gateway endpoint, both pointed at
    WP5's mock upstream and named by the same slug — the pair `resolve_connection` needs to
    route a `mode: agenta` connection through `custom/{slug}` (D30)."""
    provider, model = _HARNESS_CONNECTIONS[harness]
    slug = f"wp14-{harness}-{uuid4().hex[:8]}"

    _assert_ok(
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
    _assert_ok(
        mod_api(
            "POST",
            "/gateways/llms/endpoints/",
            json={
                "endpoint": {
                    "slug": slug,
                    "provider_key": provider,
                    "deployment_kind": "custom",
                    "secret_id": None,  # the mock needs no upstream secret (D23)
                    "data": {
                        "route": {"base_url": _MOCK_BASE_URL},
                        "models": {"allowlist": [model]},
                    },
                }
            },
        )
    )
    return {"slug": slug, "model": model}


@pytest.mark.parametrize("harness", ["codex", "claude"])
@pytest.mark.parametrize(
    "mcp_gateway_connection", ["builtin", "standard", "custom"], indirect=True
)
def test_agent_harness_calls_echo_through_each_mock_mcp_gateway_route(
    harness, mock_custom_connection, mcp_gateway_connection, mod_services_api
):
    """The real service -> runner -> harness path calls a gateway-backed mock MCP tool."""
    marker = f"WP33-MCP-{harness}-{uuid4().hex[:12]}"
    resp = mod_services_api(
        "POST",
        "/agent/v0/invoke",
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
                            "model": mock_custom_connection["model"],
                            "connection": {
                                "mode": "agenta",
                                "slug": mock_custom_connection["slug"],
                            },
                        },
                        "mcps": [
                            {
                                "name": "mock-mcp",
                                "connection": mcp_gateway_connection,
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
    assert messages[-1]["role"] == "assistant"
    # The deterministic mock model emits a tool call only when the harness receives the MCP
    # tool. It returns this marker only after the MCP tool result re-enters the model turn.
    assert marker in messages[-1]["content"]
