"""OR28: a gateway refusal must reach the caller with its code, on every harness.

Two refusals, one per plane, because they leave the platform by different routes. The
control-plane refusal never reaches a harness at all: the SDK resolver refuses before the run
starts. The data-plane refusal is the interesting one — it is the harness's provider SDK that
receives the gateway's 403, and each harness mangles it differently on the way back out, which
is what OR28 measured.

The assertion is `failure_code`, not prose, because prose is exactly what the three harnesses
disagree about. A harness that folded the refusal into its ANSWER (Codex did) must fail the run
rather than report a success whose only content is the refusal.
"""

from __future__ import annotations

import os
from uuid import uuid4

import pytest

pytestmark = [pytest.mark.acceptance]

_MOCK_BASE_URL = "http://mock-llm-gateway:9091/v1"
_MOCKS_ENABLED = os.getenv("AGENTA_GATEWAYS_MOCKS_ENABLED", "").lower() == "true"
_HARNESS_CONNECTIONS = {
    "pi_core": ("openai", "mock/echo"),
    "codex": ("openai", "gpt-5.5"),
    "claude": ("anthropic", "claude-sonnet-5"),
}


def _assert_ok(response):
    assert response.status_code == 200, response.text
    return response.json()


@pytest.fixture(params=["pi_core", "codex", "claude"])
def harness(request):
    return request.param


@pytest.fixture
def refusing_endpoint(harness, mod_api):
    """A registered custom endpoint whose allow-list excludes the model the agent will ask for."""
    if not _MOCKS_ENABLED:
        pytest.skip("gateway mock services are disabled")

    provider, model = _HARNESS_CONNECTIONS[harness]
    slug = f"or28-{harness}-{uuid4().hex[:8]}"
    cleanup: list[tuple[str, str]] = []
    try:
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
                            "models": {"allowlist": ["a-model-nobody-asks-for"]},
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


def _invoke(mod_services_api, harness, slug, model):
    return mod_services_api(
        "POST",
        "/agent/v0/invoke",
        timeout=300,
        json={
            "data": {
                "inputs": {"messages": [{"role": "user", "content": "say hello"}]},
                "parameters": {
                    "agent": {
                        "harness": {"kind": harness},
                        "llm": {
                            "model": model,
                            "connection": {"mode": "agenta", "slug": slug},
                        },
                    }
                },
            }
        },
    )


@pytest.mark.slow
@pytest.mark.xdist_group(name="agent-gateway-mock-matrix")
def test_a_data_plane_refusal_reaches_the_caller_with_its_code(
    harness, refusing_endpoint, mod_services_api
):
    resp = _invoke(
        mod_services_api, harness, refusing_endpoint["slug"], refusing_endpoint["model"]
    )

    body = resp.json()
    status = body.get("status") or {}
    # A refused run is a failed run on every harness. Codex used to answer 200 with the refusal
    # as the assistant's message, which is the same information reported as its own opposite.
    assert resp.status_code >= 400, body
    assert status.get("failure_code") == "model_not_allowed", body


@pytest.mark.slow
@pytest.mark.xdist_group(name="agent-gateway-mock-matrix")
def test_a_control_plane_refusal_reaches_the_caller_with_its_code(
    harness, mod_services_api
):
    """An endpoint slug that was never registered: refused before any harness starts."""
    model = _HARNESS_CONNECTIONS[harness][1]
    resp = _invoke(
        mod_services_api, harness, f"never-registered-{uuid4().hex[:8]}", model
    )

    body = resp.json()
    status = body.get("status") or {}
    assert resp.status_code == 422, body
    assert status.get("failure_code") == "endpoint_not_found", body
    assert "not found" in (status.get("message") or ""), body
