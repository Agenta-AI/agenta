"""What the agent app sends when it exchanges a caller's credential.

This is the hop the product actually takes: the browser (or the release gate) posts to the
agent service with the END USER's ApiKey, and the service exchanges it at
`/access/permissions/check` for the credential a run uses to read the project's secrets.
Nothing about that ApiKey says a run is starting, and the exchange route is publicly
reachable, so the platform's own secret is what distinguishes this hop from a browser
asking for a credential directly. Drop it and every run against a write-only secret
resolves to the redacted shape and fails; leak it and the guarantee is gone. Hence a test
on the real app, not just on the middleware in isolation.
"""

from __future__ import annotations

from typing import Any, Dict, Optional

import pytest
from fastapi.testclient import TestClient

from agenta.sdk.middlewares.routing import auth as auth_middleware

from oss.src.agent import agent_v0_app


class _FakeResponse:
    def __init__(self, body: Dict[str, Any]) -> None:
        self.status_code = 200
        self._body = body
        self.headers: Dict[str, str] = {}

    def json(self) -> Dict[str, Any]:
        return self._body


class _RecordingClient:
    """Stands in for the httpx client the exchange uses, keeping the headers it saw."""

    last_headers: Optional[Dict[str, str]] = None

    async def __aenter__(self) -> "_RecordingClient":
        return self

    async def __aexit__(self, *args: Any) -> None:
        return None

    async def get(self, *args: Any, **kwargs: Any) -> _FakeResponse:
        type(self).last_headers = kwargs.get("headers")
        return _FakeResponse(
            {"effect": "allow", "credentials": "Secret granted-run-credential"}
        )


@pytest.fixture(name="exchange")
def _exchange(monkeypatch):
    monkeypatch.setattr(auth_middleware, "_AUTH_ENABLED", True)
    monkeypatch.setattr(auth_middleware, "_CACHE_ENABLED", False)
    monkeypatch.setattr(auth_middleware.httpx, "AsyncClient", _RecordingClient)
    _RecordingClient.last_headers = None
    return _RecordingClient


def _post(client: TestClient):
    return client.post(
        "/runtime/subscription-status",
        json={"harness": "codex"},
        headers={"Authorization": "ApiKey caller-key"},
    )


def test_the_service_proves_what_it_is_when_it_exchanges_a_users_key(
    exchange, monkeypatch
):
    monkeypatch.setattr(auth_middleware, "_RUNTIME_KEY", "runtime-key-for-tests")

    _post(TestClient(agent_v0_app))

    headers = exchange.last_headers or {}
    assert headers.get("X-Agenta-Runtime-Key") == "runtime-key-for-tests"
    # The user's own credential still travels: the key says which RUNTIME is asking, it
    # does not change WHO is asking.
    assert headers.get("Authorization") == "ApiKey caller-key"


def test_a_service_without_the_key_sends_none(exchange, monkeypatch):
    # Such a deployment gets an ungranted credential and cannot run against write-only
    # secrets — it must not send an empty header a comparison might accept.
    monkeypatch.setattr(auth_middleware, "_RUNTIME_KEY", "")

    _post(TestClient(agent_v0_app))

    assert "X-Agenta-Runtime-Key" not in (exchange.last_headers or {})
