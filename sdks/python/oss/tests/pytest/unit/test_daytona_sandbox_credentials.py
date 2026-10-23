"""The credential the Daytona sandbox gets for user-written evaluator code.

The service runs with a credential that can carry the secret-resolve grant. The code in the
sandbox is written by the user, so the sandbox must get the same scope with no grant, and
must get nothing when a grant-free credential cannot be had.
"""

import base64
import json
from unittest.mock import MagicMock

import httpx
import pytest

import agenta as ag
from agenta.sdk.contexts.running import RunningContext
from agenta.sdk.engines.running.runners import daytona as daytona_module
from agenta.sdk.engines.running.runners.daytona import (
    DaytonaRunner,
    _sandbox_credentials,
)

API_URL = "http://api.test/api"


def _token(claims: dict) -> str:
    def part(value: dict) -> str:
        raw = base64.urlsafe_b64encode(json.dumps(value).encode()).decode()
        return raw.rstrip("=")

    return f"Secret {part({'alg': 'HS256'})}.{part(claims)}.signature"


GRANTED = _token({"project_id": "p", "grants": ["secret-resolve"]})
NARROWED = _token({"project_id": "p"})


def _response(status_code: int, body) -> MagicMock:
    response = MagicMock()
    response.status_code = status_code
    response.is_success = 200 <= status_code < 300
    response.json.return_value = body
    return response


@pytest.fixture
def api(monkeypatch):
    calls = []
    reply = {"response": _response(200, {"effect": "allow", "credentials": NARROWED})}

    def fake_get(url, params=None, headers=None, timeout=None):
        calls.append({"url": url, "params": params, "headers": headers})
        if isinstance(reply["response"], Exception):
            raise reply["response"]
        return reply["response"]

    monkeypatch.setattr(httpx, "get", fake_get)
    return calls, reply


def test_the_sandbox_gets_a_credential_without_the_grant(api):
    calls, _ = api

    assert _sandbox_credentials(GRANTED, API_URL) == NARROWED

    assert len(calls) == 1
    assert calls[0]["url"] == f"{API_URL}/access/permissions/check"
    assert calls[0]["params"]["without_grants"] == "true"
    assert calls[0]["headers"] == {"Authorization": GRANTED}


def test_the_runtime_key_is_never_sent_on_the_narrowing_call(api, monkeypatch):
    monkeypatch.setenv("AGENTA_SERVICES_INTERNAL_KEY", "runtime-key")
    calls, _ = api

    _sandbox_credentials(GRANTED, API_URL)

    sent = {key.lower() for key in calls[0]["headers"]}
    assert "x-agenta-runtime-key" not in sent


def test_an_older_api_that_keeps_the_grant_fails_the_run(api):
    # An API before this change ignores `without_grants` and re-mints the grant.
    _, reply = api
    reply["response"] = _response(200, {"effect": "allow", "credentials": GRANTED})

    with pytest.raises(
        RuntimeError, match="did not return a credential without grants"
    ):
        _sandbox_credentials(GRANTED, API_URL)


def test_the_error_names_the_http_status(api):
    _, reply = api
    reply["response"] = _response(429, {"detail": "Too Many Requests"})

    with pytest.raises(RuntimeError, match="HTTP 429"):
        _sandbox_credentials(GRANTED, API_URL)


@pytest.mark.parametrize(
    "response",
    [
        _response(403, {"detail": "Forbidden"}),
        _response(200, {"effect": "allow", "credentials": None}),
        _response(200, {"effect": "allow", "credentials": "ApiKey abc"}),
        _response(200, {"effect": "allow", "credentials": "Secret not-a-jwt"}),
        _response(
            200,
            {"effect": "allow", "credentials": _token({"aud": "gateway"})},
        ),
        httpx.ConnectError("down"),
    ],
)
def test_any_other_answer_fails_the_run(api, response):
    # Never the grant-bearing token, and never a silent run without a credential, which
    # could turn into a wrong score instead of an error.
    _, reply = api
    reply["response"] = response

    with pytest.raises(RuntimeError, match="evaluator sandbox"):
        _sandbox_credentials(GRANTED, API_URL)


def test_no_api_url_fails_the_run(api):
    with pytest.raises(RuntimeError, match="evaluator sandbox"):
        _sandbox_credentials(GRANTED, "")


def test_a_secret_token_without_grants_is_passed_through_unchanged(api):
    # A credential minted for a non-platform URL already has the user's scope only.
    calls, _ = api

    assert _sandbox_credentials(NARROWED, API_URL) == NARROWED
    assert calls == []


def test_an_unreadable_secret_token_is_narrowed(api):
    calls, _ = api

    assert _sandbox_credentials("Secret not-a-jwt", API_URL) == NARROWED
    assert len(calls) == 1


def test_an_api_key_is_passed_through_unchanged(api):
    calls, _ = api

    assert _sandbox_credentials("ApiKey user-key", API_URL) == "ApiKey user-key"
    assert calls == []


def test_no_credential_stays_no_credential(api):
    assert _sandbox_credentials("", API_URL) == ""


def test_create_sandbox_hands_only_the_narrowed_credential(api, monkeypatch):
    monkeypatch.setenv("DAYTONA_API_KEY", "test-key")
    monkeypatch.setenv("DAYTONA_SNAPSHOT", "snap")

    created = {}

    def params_cls(**kwargs):
        created.update(kwargs)
        return kwargs

    monkeypatch.setattr(
        daytona_module, "_load_daytona", lambda: (None, None, None, params_cls)
    )
    monkeypatch.setattr(ag.DEFAULT_AGENTA_SINGLETON_INSTANCE, "host", "http://h")
    monkeypatch.setattr(ag.DEFAULT_AGENTA_SINGLETON_INSTANCE, "api_url", API_URL)

    runner = DaytonaRunner()
    runner.daytona = MagicMock()
    monkeypatch.setattr(runner, "_resolve_snapshot_id", lambda force_refresh: "id-1")

    token = RunningContext.set(RunningContext(credentials=GRANTED, vault_secrets=[]))
    try:
        runner._create_sandbox(runtime="python")
    finally:
        RunningContext.reset(token)

    env_vars = created["env_vars"]
    assert env_vars["AGENTA_CREDENTIALS"] == NARROWED
    assert GRANTED not in env_vars.values()


def _provider_key(kind: str, key: str, write_only: bool) -> dict:
    return {
        "kind": "provider_key",
        "write_only": write_only,
        "data": {"kind": kind, "provider": {"key": key}},
    }


def test_a_write_only_provider_key_never_enters_the_sandbox_env(monkeypatch):
    monkeypatch.setenv("DAYTONA_API_KEY", "test-key")
    runner = DaytonaRunner()

    token = RunningContext.set(
        RunningContext(
            vault_secrets=[
                _provider_key("openai", "sk-write-only", write_only=True),
                _provider_key("anthropic", "sk-readable", write_only=False),
            ]
        )
    )
    try:
        env_vars = runner._get_provider_env_vars()
    finally:
        RunningContext.reset(token)

    assert env_vars == {"ANTHROPIC_API_KEY": "sk-readable"}


def test_a_failed_narrowing_fails_the_run_before_any_sandbox_is_created(
    api, monkeypatch
):
    monkeypatch.setenv("DAYTONA_API_KEY", "test-key")
    monkeypatch.setenv("DAYTONA_SNAPSHOT", "snap")
    _, reply = api
    reply["response"] = _response(200, {"effect": "allow", "credentials": GRANTED})

    monkeypatch.setattr(
        daytona_module, "_load_daytona", lambda: (None, None, None, dict)
    )
    monkeypatch.setattr(ag.DEFAULT_AGENTA_SINGLETON_INSTANCE, "api_url", API_URL)

    runner = DaytonaRunner()
    runner.daytona = MagicMock()
    monkeypatch.setattr(runner, "_initialize_client", lambda: None)
    monkeypatch.setattr(runner, "_resolve_snapshot_id", lambda force_refresh: "id-1")

    token = RunningContext.set(RunningContext(credentials=GRANTED, vault_secrets=[]))
    try:
        with pytest.raises(RuntimeError, match="evaluator sandbox"):
            runner.run(
                "def evaluate(inputs, outputs, trace):\n    return 1.0\n",
                {},
                {},
                "out",
                None,
                "python",
                {"python": "{user_code}"},
                version="3",
                trace={},
            )
    finally:
        RunningContext.reset(token)

    runner.daytona.create.assert_not_called()
