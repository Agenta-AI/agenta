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

from uuid import uuid4

import pytest

pytestmark = [pytest.mark.acceptance]

_MOCK_BASE_URL = "http://mock-llm-gateway:9091/v1"
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


@pytest.mark.parametrize(
    "harness",
    [
        "pi_core",
        "codex",
        pytest.param(
            "claude",
            marks=pytest.mark.xfail(
                run=False,
                reason=(
                    "Claude Code is proprietary and intentionally not baked into the "
                    "runner image; its gateway route is live-tested only where the "
                    "locally provisioned Claude runtime is available."
                ),
            ),
        ),
    ],
)
def test_agent_run_completes_through_the_gateway(
    harness, mock_custom_connection, mod_services_api
):
    """POST /agent/v0/invoke with a named connection routes the model call through the
    gateway's `custom/{slug}` route rather than a direct provider socket. Success (and the
    mock's echoed content) is only reachable this way: no key for a real provider is
    configured anywhere in this run."""
    resp = mod_services_api(
        "POST",
        "/agent/v0/invoke",
        json={
            "data": {
                "inputs": {"messages": [{"role": "user", "content": "hi"}]},
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
                    }
                },
            },
        },
    )

    body = _assert_ok(resp)
    messages = body["data"]["outputs"]["messages"]
    assert messages, "expected at least one assistant message"
    assert messages[-1]["role"] == "assistant"
    # WP5's mock echoes the request's last message content back (specs-wp5.md).
    assert "hi" in messages[-1]["content"]
