"""``POST /runtime/subscription-status``: runner outcomes -> the three public states.

Every case drives the real client through an ``httpx.MockTransport``, so the status codes,
JSON decoding, and error types are the real ones — only the socket is fake. No live runner.
"""

from __future__ import annotations

import json

import httpx
import pytest
from fastapi.testclient import TestClient

from agenta.sdk.agents import AgentTemplate
from agenta.sdk.middlewares.routing import auth as auth_middleware

from oss.src.agent import agent_v0_app
from oss.src.agent import runtime_status
from oss.src.agent.app import select_backend

RUNNER_URL = "http://sandbox-agent:8765"
RUNNER_TOKEN = "s3cret-runner-token"

VALID_BODY = {
    "version": 1,
    "harnesses": {
        "codex": {"state": "ready", "provider": "openai"},
        "pi_core": {"state": "not_configured"},
    },
}


@pytest.fixture(autouse=True)
def _runner_env(monkeypatch):
    monkeypatch.setenv("AGENTA_RUNNER_INTERNAL_URL", RUNNER_URL)
    monkeypatch.setenv("AGENTA_RUNNER_TOKEN", RUNNER_TOKEN)


def _mock_runner(monkeypatch, handler):
    """Point the client at ``handler`` and return the list of requests it received."""
    seen: list = []

    def _handler(request: httpx.Request) -> httpx.Response:
        seen.append(request)
        return handler(request)

    monkeypatch.setattr(
        runtime_status,
        "_client",
        lambda: httpx.AsyncClient(transport=httpx.MockTransport(_handler)),
    )
    return seen


def _responds(status_code: int, *, json_body=None, text: str = ""):
    if json_body is not None:
        return lambda _request: httpx.Response(status_code, json=json_body)
    return lambda _request: httpx.Response(status_code, text=text)


def _raises(exception: Exception):
    def _handler(_request):
        raise exception

    return _handler


# ---------------------------------------------------------------------------
# Mapping
# ---------------------------------------------------------------------------


async def test_valid_response_maps_to_connected(monkeypatch):
    _mock_runner(monkeypatch, _responds(200, json_body=VALID_BODY))

    status = await runtime_status.fetch_subscription_status()

    assert status.runner == "connected"
    assert status.harnesses["codex"].state == "ready"
    assert status.harnesses["codex"].provider == "openai"
    assert status.harnesses["pi_core"].state == "not_configured"
    assert status.harnesses["pi_core"].provider is None
    assert status.checked_at.endswith("Z")


async def test_runner_is_called_with_the_shared_token(monkeypatch):
    seen = _mock_runner(monkeypatch, _responds(200, json_body=VALID_BODY))

    await runtime_status.fetch_subscription_status()

    assert len(seen) == 1
    assert str(seen[0].url) == f"{RUNNER_URL}/subscription-status"
    assert seen[0].headers["authorization"] == f"Bearer {RUNNER_TOKEN}"


async def test_unknown_runner_fields_are_dropped(monkeypatch):
    _mock_runner(
        monkeypatch,
        _responds(
            200,
            json_body={
                "version": 1,
                "harnesses": {
                    "claude": {
                        "state": "ready",
                        "provider": "anthropic",
                        "account": "someone@example.com",
                        "path": "/root/.claude/login.json",
                        "token": RUNNER_TOKEN,
                        "plan": "max",
                    }
                },
            },
        ),
    )

    status = await runtime_status.fetch_subscription_status()

    assert status.harnesses["claude"].model_dump(exclude_none=True) == {
        "state": "ready",
        "provider": "anthropic",
    }


async def test_provider_families_pass_through(monkeypatch):
    """A multi-provider harness names its families; that is the only way the card can."""
    _mock_runner(
        monkeypatch,
        _responds(
            200,
            json_body={
                "version": 1,
                "harnesses": {
                    "pi_core": {"state": "ready", "providers": ["openai", "anthropic"]},
                    "codex": {"state": "ready", "provider": "openai"},
                },
            },
        ),
    )

    status = await runtime_status.fetch_subscription_status()

    assert status.harnesses["pi_core"].providers == ["anthropic", "openai"]
    assert status.harnesses["codex"].providers is None


@pytest.mark.parametrize(
    "providers,expected",
    [
        (["openai", "openai"], ["openai"]),  # deduped
        (["openai", "quokka-ai"], ["openai"]),  # a family the card cannot render
        (["quokka-ai"], None),  # nothing left to say
        (["openai", 7, None, {"provider": "anthropic"}], ["openai"]),  # not strings
        ("openai", None),  # not a list
        ([], None),
    ],
)
async def test_only_known_provider_families_reach_the_card(
    monkeypatch, providers, expected
):
    """The list is closed at the boundary, exactly like the state vocabulary above it."""
    _mock_runner(
        monkeypatch,
        _responds(
            200,
            json_body={
                "version": 1,
                "harnesses": {"pi_core": {"state": "ready", "providers": providers}},
            },
        ),
    )

    status = await runtime_status.fetch_subscription_status()

    # The entry survives either way: an unreadable extra never costs the state.
    assert status.harnesses["pi_core"].state == "ready"
    assert status.harnesses["pi_core"].providers == expected


@pytest.mark.parametrize(
    "provider,expected",
    [
        ("openai", "openai"),
        ("anthropic", "anthropic"),
        ("quokka-ai", None),  # a family the card cannot render
        ("/home/agent/.codex/auth.json", None),  # a path, not a family
        ("sk-proj-abc123", None),  # a credential, not a family
        (7, None),  # not a string
        ({"name": "openai"}, None),  # not a string
    ],
)
async def test_only_known_provider_families_reach_the_card_singular(
    monkeypatch, provider, expected
):
    """`provider` is closed exactly like `providers`: the card draws this family too."""
    _mock_runner(
        monkeypatch,
        _responds(
            200,
            json_body={
                "version": 1,
                "harnesses": {"codex": {"state": "ready", "provider": provider}},
            },
        ),
    )

    status = await runtime_status.fetch_subscription_status()

    # The entry survives either way: an unreadable extra never costs the state.
    assert status.harnesses["codex"].state == "ready"
    assert status.harnesses["codex"].provider == expected


async def test_only_known_harnesses_become_response_keys(monkeypatch):
    """Map keys are runner-controlled too, so they are allow-listed like the values."""
    _mock_runner(
        monkeypatch,
        _responds(
            200,
            json_body={
                "version": 1,
                "harnesses": {
                    "codex": {"state": "ready", "provider": "openai"},
                    # A harness a newer runner invents, and three shapes of runner leakage.
                    "quokka": {"state": "ready"},
                    "/home/agent/.codex/auth.json": {"state": "ready"},
                    "sk-proj-abc123": {"state": "ready"},
                    "acme-corp@example.com": {"state": "ready"},
                },
            },
        ),
    )

    status = await runtime_status.fetch_subscription_status()

    assert set(status.harnesses) == {"codex"}
    assert status.harnesses["codex"].state == "ready"


async def test_the_harness_map_cannot_grow_past_the_known_harnesses(monkeypatch):
    """Closing the key set caps the map, whatever the runner sends."""
    _mock_runner(
        monkeypatch,
        _responds(
            200,
            json_body={
                "version": 1,
                "harnesses": {
                    f"harness-{index}": {"state": "ready"} for index in range(5000)
                },
            },
        ),
    )

    status = await runtime_status.fetch_subscription_status()

    assert status.harnesses == {}
    assert len(status.harnesses) <= len(runtime_status.KNOWN_HARNESSES)


@pytest.mark.parametrize(
    "exception",
    [
        httpx.ConnectError("connection refused"),
        httpx.ReadTimeout("timed out"),
        # Not an `httpx.HTTPError`: a misconfigured runner URL must still answer, not 500.
        httpx.InvalidURL("not a url"),
        RuntimeError("something the client did not promise"),
    ],
)
async def test_transport_failure_maps_to_unavailable(monkeypatch, exception):
    _mock_runner(monkeypatch, _raises(exception))

    status = await runtime_status.fetch_subscription_status()

    assert status.runner == "unavailable"
    assert status.harnesses is None


@pytest.mark.parametrize("status_code", [404, 405])
async def test_missing_runner_endpoint_maps_to_incompatible(monkeypatch, status_code):
    _mock_runner(monkeypatch, _responds(status_code, text="Not Found"))

    status = await runtime_status.fetch_subscription_status()

    assert status.runner == "incompatible"
    assert status.harnesses is None


@pytest.mark.parametrize("status_code", [401, 403, 500, 502])
async def test_other_runner_errors_map_to_unavailable(monkeypatch, status_code):
    _mock_runner(monkeypatch, _responds(status_code, text="nope"))

    status = await runtime_status.fetch_subscription_status()

    assert status.runner == "unavailable"


@pytest.mark.parametrize(
    "body",
    [
        {"harnesses": {}},  # no version
        {"version": 1, "harnesses": []},  # harnesses is not a map
        {"version": 99, "harnesses": {}},  # a version this service cannot read
    ],
)
async def test_invalid_runner_body_maps_to_incompatible(monkeypatch, body):
    _mock_runner(monkeypatch, _responds(200, json_body=body))

    status = await runtime_status.fetch_subscription_status()

    assert status.runner == "incompatible"
    assert status.harnesses is None


@pytest.mark.parametrize(
    "entry",
    [
        {"provider": "openai"},  # no state
        "ready",  # entry is not an object
        None,
        [],
    ],
)
async def test_one_unreadable_harness_entry_does_not_condemn_the_rest(
    monkeypatch, entry
):
    """A harness this service cannot read is dropped; the readable ones still answer."""
    _mock_runner(
        monkeypatch,
        _responds(
            200,
            json_body={
                "version": 1,
                "harnesses": {"codex": entry, "claude": {"state": "ready"}},
            },
        ),
    )

    status = await runtime_status.fetch_subscription_status()

    assert status.runner == "connected"
    assert set(status.harnesses) == {"claude"}
    assert status.harnesses["claude"].state == "ready"


@pytest.mark.parametrize("state", ["expired", "READY", "", "logged_out", "ready "])
async def test_an_unknown_harness_state_becomes_unsupported(monkeypatch, state):
    """A state word from a newer runner is one harness this deployment cannot report."""
    _mock_runner(
        monkeypatch,
        _responds(
            200,
            json_body={
                "version": 1,
                "harnesses": {
                    "codex": {"state": state, "provider": "openai"},
                    "claude": {"state": "login_missing", "provider": "anthropic"},
                },
            },
        ),
    )

    status = await runtime_status.fetch_subscription_status()

    assert status.runner == "connected"
    assert status.harnesses["codex"].state == "unsupported"
    # Only that harness is affected; the rest pass through untouched.
    assert status.harnesses["claude"].state == "login_missing"


@pytest.mark.parametrize(
    "state",
    ["ready", "not_configured", "login_missing", "login_unusable", "unsupported"],
)
async def test_every_allowed_state_passes_through(monkeypatch, state):
    _mock_runner(
        monkeypatch,
        _responds(
            200, json_body={"version": 1, "harnesses": {"codex": {"state": state}}}
        ),
    )

    status = await runtime_status.fetch_subscription_status()

    assert status.harnesses["codex"].state == state


async def test_undecodable_runner_body_maps_to_incompatible(monkeypatch):
    _mock_runner(monkeypatch, _responds(200, text="<html>proxy error</html>"))

    status = await runtime_status.fetch_subscription_status()

    assert status.runner == "incompatible"


@pytest.mark.parametrize(
    "missing", ["AGENTA_RUNNER_INTERNAL_URL", "AGENTA_RUNNER_TOKEN"]
)
async def test_unconfigured_runner_maps_to_unavailable(monkeypatch, missing):
    monkeypatch.delenv(missing, raising=False)
    seen = _mock_runner(monkeypatch, _responds(200, json_body=VALID_BODY))

    status = await runtime_status.fetch_subscription_status()

    assert status.runner == "unavailable"
    assert seen == []


async def test_status_and_a_run_resolve_the_same_runner(monkeypatch):
    """A status check must describe the runner a run would actually use."""
    monkeypatch.setenv("AGENTA_RUNNER_ENABLED_SANDBOX_PROVIDERS", "local")
    seen = _mock_runner(monkeypatch, _responds(200, json_body=VALID_BODY))

    await runtime_status.fetch_subscription_status()
    backend = select_backend(AgentTemplate(harness="pi_core", sandbox="local"))

    assert str(seen[0].url).startswith(backend._url)


# ---------------------------------------------------------------------------
# Route
# ---------------------------------------------------------------------------


@pytest.fixture
def authed(monkeypatch):
    """Let the SDK auth middleware through, as a verified Agenta user would."""

    async def _allow(*_args, **_kwargs):
        # `get_credentials` returns the caller's credential and a separate trace-ingest
        # one; a single value here unpacks as two characters in the middleware.
        return "ApiKey test-credentials", None

    monkeypatch.setattr(auth_middleware, "get_credentials", _allow)
    return TestClient(agent_v0_app)


def test_route_rejects_an_unauthenticated_caller(monkeypatch):
    seen = _mock_runner(monkeypatch, _responds(200, json_body=VALID_BODY))

    async def _deny(*_args, **_kwargs):
        raise auth_middleware.DenyException(status_code=401, content="Unauthorized")

    monkeypatch.setattr(auth_middleware, "get_credentials", _deny)

    response = TestClient(agent_v0_app).post(
        "/runtime/subscription-status", json={"harness": "codex"}
    )

    assert response.status_code == 401
    assert seen == []


def test_route_returns_the_public_shape(monkeypatch, authed):
    _mock_runner(monkeypatch, _responds(200, json_body=VALID_BODY))

    response = authed.post("/runtime/subscription-status", json={"harness": "codex"})

    assert response.status_code == 200
    body = response.json()
    assert body["runner"] == "connected"
    assert body["harnesses"] == {
        "codex": {"state": "ready", "provider": "openai"},
        "pi_core": {"state": "not_configured"},
    }
    assert set(body) == {"runner", "checked_at", "harnesses"}


def test_route_carries_provider_families_and_omits_the_empty_field(monkeypatch, authed):
    _mock_runner(
        monkeypatch,
        _responds(
            200,
            json_body={
                "version": 1,
                "harnesses": {
                    "pi_core": {"state": "ready", "providers": ["openai"]},
                    "claude": {"state": "ready", "provider": "anthropic"},
                },
            },
        ),
    )

    response = authed.post("/runtime/subscription-status", json={"harness": "pi_core"})

    assert response.json()["harnesses"] == {
        "pi_core": {"state": "ready", "providers": ["openai"]},
        "claude": {"state": "ready", "provider": "anthropic"},
    }


def test_route_omits_harnesses_when_the_runner_is_down(monkeypatch, authed):
    _mock_runner(monkeypatch, _raises(httpx.ConnectError("connection refused")))

    response = authed.post("/runtime/subscription-status", json={})

    assert response.status_code == 200
    assert response.json()["runner"] == "unavailable"
    assert "harnesses" not in response.json()


def test_route_never_leaks_the_token_or_the_runner_location(monkeypatch, authed):
    _mock_runner(
        monkeypatch,
        _responds(
            200,
            json_body={
                "version": 1,
                "harnesses": {
                    "codex": {
                        "state": "login_unusable",
                        "error": f"cannot read /root/.codex/auth.json ({RUNNER_TOKEN})",
                    }
                },
            },
        ),
    )

    response = authed.post("/runtime/subscription-status", json={"harness": "codex"})
    raw = json.dumps(response.json())

    assert RUNNER_TOKEN not in raw
    assert RUNNER_URL not in raw
    assert "/root/" not in raw


def test_route_rejects_a_caller_supplied_runner(monkeypatch, authed):
    seen = _mock_runner(monkeypatch, _responds(200, json_body=VALID_BODY))

    response = authed.post(
        "/runtime/subscription-status",
        json={"harness": "codex", "runner_url": "http://attacker.example"},
    )

    assert response.status_code == 422
    assert seen == []


def test_route_rejects_an_unknown_harness(monkeypatch, authed):
    seen = _mock_runner(monkeypatch, _responds(200, json_body=VALID_BODY))

    response = authed.post("/runtime/subscription-status", json={"harness": "cursor"})

    assert response.status_code == 422
    assert seen == []
