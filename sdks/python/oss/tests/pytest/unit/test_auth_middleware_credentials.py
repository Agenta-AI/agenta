"""Unit tests for the routing auth middleware's credential exchange.

The workflow service exchanges the END USER's credential at `GET /permissions/check`, so
the token it forwards says nothing about who is asking. These tests pin the one thing that
does: the runtime key header that tells the platform a run is starting.
"""

from __future__ import annotations

from types import SimpleNamespace
from typing import Any, Dict, Optional

import pytest

from agenta.sdk.middlewares.routing import auth as auth_module
from agenta.sdk.utils.cache import TTLLRUCache


class _FakeRequest:
    def __init__(self) -> None:
        self.headers = {"authorization": "ApiKey caller-key"}
        self.cookies: Dict[str, str] = {}
        self.state = SimpleNamespace(otel={"baggage": {"project_id": "project-1"}})
        self.query_params: Dict[str, str] = {}


class _FakeResponse:
    def __init__(self, body: Dict[str, Any]) -> None:
        self.status_code = 200
        self._body = body
        self.headers: Dict[str, str] = {}

    def json(self) -> Dict[str, Any]:
        return self._body


class _FakeAsyncClient:
    """Stands in for httpx.AsyncClient; records the headers each call carried."""

    call_count = 0
    body: Dict[str, Any] = {}
    last_headers: Optional[Dict[str, str]] = None

    async def __aenter__(self) -> "_FakeAsyncClient":
        return self

    async def __aexit__(self, *args: Any) -> None:
        return None

    async def get(self, *args: Any, **kwargs: Any) -> _FakeResponse:
        type(self).call_count += 1
        type(self).last_headers = kwargs.get("headers")
        return _FakeResponse(type(self).body)


@pytest.fixture
def platform(monkeypatch):
    monkeypatch.setattr(auth_module, "_AUTH_ENABLED", True)
    monkeypatch.setattr(auth_module, "_CACHE_ENABLED", True)
    monkeypatch.setattr(auth_module, "_cache", TTLLRUCache())
    _FakeAsyncClient.call_count = 0
    _FakeAsyncClient.body = {}
    _FakeAsyncClient.last_headers = None
    monkeypatch.setattr(auth_module.httpx, "AsyncClient", _FakeAsyncClient)
    return _FakeAsyncClient


async def _get_credentials() -> Optional[str]:
    return await auth_module.get_credentials(
        _FakeRequest(),  # type: ignore[arg-type]
        "http://agenta.test",
    )


async def test_deny_body_raises(platform):
    platform.body = {"effect": "deny"}

    with pytest.raises(auth_module.DenyException):
        await _get_credentials()


async def test_the_runtime_key_rides_the_exchange_when_configured(
    platform, monkeypatch
):
    # What tells the platform that a run is starting, rather than a browser asking for a
    # credential: the exchange forwards the END USER's token either way, so this header
    # is the only thing that distinguishes them.
    monkeypatch.setattr(auth_module, "_RUNTIME_KEY", "runtime-key-for-tests")
    platform.body = {"effect": "allow", "credentials": "Secret general-token"}

    await _get_credentials()

    assert platform.last_headers["X-Agenta-Runtime-Key"] == "runtime-key-for-tests"
    # The caller's own credential still travels; the key identifies the runtime, it does
    # not replace the principal.
    assert platform.last_headers["Authorization"] == "ApiKey caller-key"


async def test_no_runtime_key_means_no_header(platform, monkeypatch):
    # A deployment that configures none simply gets an ungranted credential; it must not
    # send an empty header that a comparison might treat as a value.
    monkeypatch.setattr(auth_module, "_RUNTIME_KEY", "")
    platform.body = {"effect": "allow", "credentials": "Secret general-token"}

    await _get_credentials()

    assert "X-Agenta-Runtime-Key" not in (platform.last_headers or {})
