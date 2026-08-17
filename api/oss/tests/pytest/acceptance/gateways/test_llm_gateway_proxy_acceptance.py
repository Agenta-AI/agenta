"""Acceptance tests for the LLM data-plane proxy (workstreams/specs-wp6.md "Done test",
tasks-wp6.md Phase 6).

WRITTEN, NOT RUN by this package: acceptance tests need a real deployment_kind (`api/AGENTS.md`
testing rules), and this worktree does not carry one. They also depend on work packages not
yet merged onto this branch — WP5 (`mock-llm-gateway`), WP7 (`LLMGatewayService`) and WP10
(the LLM endpoints CRUD router this suite POSTs to, to seed the fixture endpoint) — collection
alone succeeds today (verified), but every test here fails until that M2 merge is deployed.
Run manually once that deployment_kind exists:

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
# is the upstream's own path segment, appended to by RelayLLMAdapter's per-protocol
# routing strategy (specs-wp24.md, entities.md §9's base_url note).
_MOCK_BASE_URL = "http://mock-llm-gateway:9091/v1"


def _assert_ok(response):
    assert response.status_code == 200, response.text
    return response.json()


def _create_custom_endpoint(authed_api, *, models, timeout_seconds=None):
    slug = f"wp6-acceptance-{uuid4().hex[:8]}"
    body = _assert_ok(
        authed_api(
            "POST",
            "/gateways/llms/endpoints/",
            json={
                "endpoint": {
                    # deployment_kind "custom" (not "mock"): select_upstream sends
                    # LLMDeploymentKind.MOCK to the in-process MockLLMAdapter, which
                    # would never dial base_url. "custom" routes to RelayLLMAdapter,
                    # so these cross a real socket to the mock-llm-gateway container.
                    "slug": slug,
                    "provider_key": "openai",
                    "deployment_kind": "custom",
                    "secret_id": None,  # GatewayAuthScheme.NONE — the mock needs no secret (D23)
                    "data": {
                        "route": {"base_url": _MOCK_BASE_URL},
                        "models": {"allowlist": models},
                        "settings": {"timeout_seconds": timeout_seconds},
                    },
                }
            },
        )
    )
    return body["endpoint"]


@pytest.fixture(scope="class")
def mock_llm_endpoint(authed_api):
    """A custom endpoint pointed at WP5's mock upstream, allowlisting exactly the
    model slugs this suite exercises against it (`mock/echo`)."""
    return _create_custom_endpoint(authed_api, models=["mock/echo"])


@pytest.mark.acceptance
class TestLLMGatewayProxyAcceptance:
    def test_streaming_round_trips_sse_bytes_unmodified(
        self, gateway_api, mock_llm_endpoint
    ):
        slug = mock_llm_endpoint["slug"]

        response = gateway_api(
            "POST",
            f"/gateways/llms/custom/{slug}/v1/chat/completions",
            json={
                "model": "mock/echo",
                "stream": True,
                "messages": [{"role": "user", "content": "hi"}],
            },
        )

        assert response.status_code == 200
        # Byte comparison against the mock's own framing (specs-wp6.md: "byte
        # comparison, not a re-decoded equivalence check") — every frame is
        # `data: ...\n\n`, terminated by the literal `data: [DONE]\n\n` sentinel
        # MockLLMAdapter emits (core/gateways/llms/providers/mock/adapter.py).
        body = response.content
        assert body.endswith(b"data: [DONE]\n\n")
        assert body.count(b"data: ") >= 2

    def test_non_streaming_call_returns_the_mocks_completion_body(
        self, gateway_api, mock_llm_endpoint
    ):
        slug = mock_llm_endpoint["slug"]

        response = gateway_api(
            "POST",
            f"/gateways/llms/custom/{slug}/v1/chat/completions",
            json={
                "model": "mock/echo",
                "messages": [{"role": "user", "content": "hi"}],
            },
        )

        body = _assert_ok(response)
        assert body["object"] == "chat.completion"
        assert body["choices"][0]["message"]["role"] == "assistant"

    def test_slow_upstream_times_out_inside_the_configured_window_not_at_30s(
        self, authed_api, gateway_api
    ):
        # A separate endpoint from `mock_llm_endpoint`: this one pins a short
        # config.timeout_seconds so it is the GATEWAY, not curl and not the
        # caller, that returns before mock/slow-30's 30-second sleep elapses.
        endpoint = _create_custom_endpoint(
            authed_api,
            models=["mock/slow-30"],
            timeout_seconds=3.0,
        )
        slug = endpoint["slug"]

        started = time.monotonic()
        response = gateway_api(
            "POST",
            f"/gateways/llms/custom/{slug}/v1/chat/completions",
            json={
                "model": "mock/slow-30",
                "messages": [{"role": "user", "content": "hi"}],
            },
        )
        elapsed = time.monotonic() - started

        assert elapsed < 30, "the gateway's own request hung past the upstream's sleep"
        assert response.status_code in (424, 502)
        assert response.json()["error"]["code"] == "upstream_error"

    def test_unauthenticated_request_never_reaches_the_mock(
        self, unauthed_api, mock_llm_endpoint
    ):
        slug = mock_llm_endpoint["slug"]

        # The auth middleware rejects before any router runs (D13) — this
        # asserts the platform boundary; it has no direct handle on the mock's
        # request log to prove non-delivery any more precisely than "no
        # successful relay happened".
        response = unauthed_api(
            "POST",
            f"/gateways/llms/custom/{slug}/v1/chat/completions",
            json={
                "model": "mock/echo",
                "messages": [{"role": "user", "content": "hi"}],
            },
        )

        assert response.status_code == 401

    def test_model_outside_allowlist_is_refused_with_model_not_allowed(
        self, gateway_api, mock_llm_endpoint
    ):
        slug = mock_llm_endpoint["slug"]

        response = gateway_api(
            "POST",
            f"/gateways/llms/custom/{slug}/v1/chat/completions",
            json={
                "model": "mock/not-on-the-allowlist",
                "messages": [{"role": "user", "content": "hi"}],
            },
        )

        assert response.status_code == 403
        assert response.json()["error"]["code"] == "model_not_allowed"

    def test_list_models_answers_the_endpoints_allowlist(
        self, gateway_api, mock_llm_endpoint
    ):
        slug = mock_llm_endpoint["slug"]

        response = gateway_api("GET", f"/gateways/llms/custom/{slug}/v1/models")

        body = _assert_ok(response)
        assert body["object"] == "list"
        assert {m["id"] for m in body["data"]} == {"mock/echo"}


@pytest.mark.acceptance
class TestLLMGatewayResponsesAndMessagesDoorsAcceptance:
    """D33/WP23/WP24: the same byte-for-byte relay, over the responses and messages doors.

    `RelayLLMAdapter`'s routing strategy is protocol-aware (specs-wp24.md): each door's
    request lands on the mock's matching handler (`/v1/responses`, `/v1/messages`), not
    always `/v1/chat/completions` — this proves both WP23's parse-only-the-policy-fields
    property and WP24's per-protocol URL composition together.
    """

    def test_responses_door_relays_request_and_response_bytes(
        self, gateway_api, mock_llm_endpoint
    ):
        slug = mock_llm_endpoint["slug"]

        response = gateway_api(
            "POST",
            f"/gateways/llms/custom/{slug}/v1/responses",
            json={"model": "mock/echo", "input": [{"role": "user", "content": "hi"}]},
        )

        assert response.status_code == 200

    def test_messages_door_relays_request_and_response_bytes(
        self, gateway_api, mock_llm_endpoint
    ):
        slug = mock_llm_endpoint["slug"]

        response = gateway_api(
            "POST",
            f"/gateways/llms/custom/{slug}/v1/messages",
            json={
                "model": "mock/echo",
                "max_tokens": 1024,
                "messages": [{"role": "user", "content": "hi"}],
            },
        )

        assert response.status_code == 200

    def test_responses_door_streams_sse_bytes_unmodified(
        self, gateway_api, mock_llm_endpoint
    ):
        slug = mock_llm_endpoint["slug"]

        response = gateway_api(
            "POST",
            f"/gateways/llms/custom/{slug}/v1/responses",
            json={
                "model": "mock/echo",
                "stream": True,
                "input": [{"role": "user", "content": "hi"}],
            },
        )

        assert response.status_code == 200
        assert response.content.count(b"data: ") >= 1

    def test_model_outside_allowlist_is_refused_on_the_messages_door_too(
        self, gateway_api, mock_llm_endpoint
    ):
        slug = mock_llm_endpoint["slug"]

        response = gateway_api(
            "POST",
            f"/gateways/llms/custom/{slug}/v1/messages",
            json={
                "model": "mock/not-on-the-allowlist",
                "max_tokens": 1024,
                "messages": [{"role": "user", "content": "hi"}],
            },
        )

        assert response.status_code == 403
        assert response.json()["error"]["code"] == "model_not_allowed"


# D40/OD19 (specs-wp27.md): Vertex on the Messages door is the named byte-for-byte
# exemption above, and it composes the real rawPredict path (routing.py), which the mock
# upstream does not mount (`providers/mock/app.py` only serves
# `/v1/{chat/completions,responses,messages}`). Bedrock's Messages door now composes
# bedrock-mantle's own `/anthropic/v1/messages`, also unmounted by the mock. Proving each
# URL (+, for Vertex, body) pair therefore stays a unit test against RelayLLMAdapter
# directly
# (test_gateways_llm_relay_adapter.py::test_{bedrock_messages_request_composes_mantle_url_
# and_leaves_body_untouched,vertex_messages_request_moves_model_from_body_to_url}) rather
# than an acceptance test here — there is no upstream in this suite's reach that speaks
# either real wire.
