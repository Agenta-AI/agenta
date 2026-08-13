"""Acceptance tests for the LLM data-plane proxy (workstreams/specs-wp6.md "Done test",
tasks-wp6.md Phase 6).

WRITTEN, NOT RUN by this package: acceptance tests need a real deployment (`api/AGENTS.md`
testing rules), and this worktree does not carry one. They also depend on work packages not
yet merged onto this branch — WP5 (`fake-llm-gateway`), WP7 (`LlmGatewayService`) and WP10
(the LLM endpoints CRUD router this suite POSTs to, to seed the fixture endpoint) — collection
alone succeeds today (verified), but every test here fails until that M2 merge is deployed.
Run manually once that deployment exists:

    load-env hosting/docker-compose/oss/.env.oss.dev
    bash hosting/docker-compose/run.sh --oss --dev --build
    cd api && py-run-tests  # or: pytest oss/tests/pytest/acceptance/gateways -m acceptance

Matches `plan.md` WP6's done condition verbatim: "a streamed response is relayed unmodified
and a hung upstream times out rather than hanging the gateway."
"""

import time
from uuid import uuid4

import pytest

# Compose service name and port WP5 owns (workstreams/specs-wp5.md); the trailing /v1
# is the upstream's own path segment, appended to by PassthroughLlmAdapter's
# `route.base_url + "/chat/completions"` (specs-wp6.md, entities.md §9's base_url note).
_FAKE_BASE_URL = "http://fake-llm-gateway:9091/v1"


def _assert_ok(response):
    assert response.status_code == 200, response.text
    return response.json()


def _create_custom_endpoint(authed_api, *, model_slugs, timeout_seconds=None):
    slug = f"wp6-acceptance-{uuid4().hex[:8]}"
    body = _assert_ok(
        authed_api(
            "POST",
            "/gateways/llms/endpoints/",
            json={
                "endpoint": {
                    "slug": slug,
                    "provider_key": "fake",
                    "deployment": "custom",
                    "secret_id": None,  # GatewayAuthScheme.NONE — the fake needs no credential (D23)
                    "data": {
                        "route": {"base_url": _FAKE_BASE_URL},
                        "model_slugs": model_slugs,
                        "config": {"timeout_seconds": timeout_seconds},
                    },
                }
            },
        )
    )
    return body["endpoint"]


@pytest.fixture(scope="class")
def fake_llm_endpoint(authed_api):
    """A custom endpoint pointed at WP5's fake upstream, allowlisting exactly the
    model slugs this suite exercises against it (`fake/echo`)."""
    return _create_custom_endpoint(authed_api, model_slugs=["fake/echo"])


@pytest.mark.acceptance
class TestLlmGatewayProxyAcceptance:
    def test_streaming_round_trips_sse_bytes_unmodified(
        self, authed_api, fake_llm_endpoint
    ):
        slug = fake_llm_endpoint["slug"]

        response = authed_api(
            "POST",
            f"/gateways/llms/custom/{slug}/v1/chat/completions",
            json={
                "model": "fake/echo",
                "stream": True,
                "messages": [{"role": "user", "content": "hi"}],
            },
        )

        assert response.status_code == 200
        # Byte comparison against the fake's own framing (specs-wp6.md: "byte
        # comparison, not a re-decoded equivalence check") — every frame is
        # `data: ...\n\n`, terminated by the literal `data: [DONE]\n\n` sentinel
        # FakeLlmAdapter emits (core/gateways/llms/providers/fake/adapter.py).
        body = response.content
        assert body.endswith(b"data: [DONE]\n\n")
        assert body.count(b"data: ") >= 2

    def test_non_streaming_call_returns_the_fakes_completion_body(
        self, authed_api, fake_llm_endpoint
    ):
        slug = fake_llm_endpoint["slug"]

        response = authed_api(
            "POST",
            f"/gateways/llms/custom/{slug}/v1/chat/completions",
            json={
                "model": "fake/echo",
                "messages": [{"role": "user", "content": "hi"}],
            },
        )

        body = _assert_ok(response)
        assert body["object"] == "chat.completion"
        assert body["choices"][0]["message"]["role"] == "assistant"

    def test_slow_upstream_times_out_inside_the_configured_window_not_at_30s(
        self, authed_api
    ):
        # A separate endpoint from `fake_llm_endpoint`: this one pins a short
        # config.timeout_seconds so it is the GATEWAY, not curl and not the
        # caller, that returns before fake/slow-30's 30-second sleep elapses.
        endpoint = _create_custom_endpoint(
            authed_api, model_slugs=["fake/slow-30"], timeout_seconds=3.0
        )
        slug = endpoint["slug"]

        started = time.monotonic()
        response = authed_api(
            "POST",
            f"/gateways/llms/custom/{slug}/v1/chat/completions",
            json={
                "model": "fake/slow-30",
                "messages": [{"role": "user", "content": "hi"}],
            },
        )
        elapsed = time.monotonic() - started

        assert elapsed < 30, "the gateway's own request hung past the upstream's sleep"
        assert response.status_code in (424, 502)
        assert response.json()["error"]["code"] == "upstream_error"

    def test_unauthenticated_request_never_reaches_the_fake(
        self, unauthed_api, fake_llm_endpoint
    ):
        slug = fake_llm_endpoint["slug"]

        # The auth middleware rejects before any router runs (D13) — this
        # asserts the platform boundary; it has no direct handle on the fake's
        # request log to prove non-delivery any more precisely than "no
        # successful relay happened".
        response = unauthed_api(
            "POST",
            f"/gateways/llms/custom/{slug}/v1/chat/completions",
            json={
                "model": "fake/echo",
                "messages": [{"role": "user", "content": "hi"}],
            },
        )

        assert response.status_code == 401

    def test_model_outside_allowlist_is_refused_with_model_not_allowed(
        self, authed_api, fake_llm_endpoint
    ):
        slug = fake_llm_endpoint["slug"]

        response = authed_api(
            "POST",
            f"/gateways/llms/custom/{slug}/v1/chat/completions",
            json={
                "model": "fake/not-on-the-allowlist",
                "messages": [{"role": "user", "content": "hi"}],
            },
        )

        assert response.status_code == 403
        assert response.json()["error"]["code"] == "model_not_allowed"

    def test_list_models_answers_the_endpoints_allowlist(
        self, authed_api, fake_llm_endpoint
    ):
        slug = fake_llm_endpoint["slug"]

        response = authed_api("GET", f"/gateways/llms/custom/{slug}/v1/models")

        body = _assert_ok(response)
        assert body["object"] == "list"
        assert {m["id"] for m in body["data"]} == {"fake/echo"}
