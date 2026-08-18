"""Unit tests for the routing auth middleware's allow-body parsing.

`GET /permissions/check` returns the caller's general credential and, on platforms that
issue one, a dedicated trace-ingest-scoped `telemetry_credentials`. The field is optional
in both directions: an older platform omits it and the SDK must degrade to the general
credential, with the cache carrying both values through a single entry.
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
    """Stands in for httpx.AsyncClient; counts calls so cache hits are observable."""

    call_count = 0
    body: Dict[str, Any] = {}

    async def __aenter__(self) -> "_FakeAsyncClient":
        return self

    async def __aexit__(self, *args: Any) -> None:
        return None

    async def get(self, *args: Any, **kwargs: Any) -> _FakeResponse:
        type(self).call_count += 1
        return _FakeResponse(type(self).body)


@pytest.fixture
def platform(monkeypatch):
    monkeypatch.setattr(auth_module, "_AUTH_ENABLED", True)
    monkeypatch.setattr(auth_module, "_CACHE_ENABLED", True)
    monkeypatch.setattr(auth_module, "_cache", TTLLRUCache())
    _FakeAsyncClient.call_count = 0
    _FakeAsyncClient.body = {}
    monkeypatch.setattr(auth_module.httpx, "AsyncClient", _FakeAsyncClient)
    return _FakeAsyncClient


async def _get_credentials() -> tuple[Optional[str], Optional[str]]:
    return await auth_module.get_credentials(
        _FakeRequest(),  # type: ignore[arg-type]
        "http://agenta.test",
    )


async def test_allow_body_with_telemetry_credentials(platform):
    platform.body = {
        "effect": "allow",
        "credentials": "Secret general-token",
        "telemetry_credentials": "Secret telemetry-token",
    }

    credentials, telemetry_credentials = await _get_credentials()

    assert credentials == "Secret general-token"
    assert telemetry_credentials == "Secret telemetry-token"


async def test_allow_body_without_telemetry_credentials(platform):
    # Older platforms omit the field entirely; the SDK degrades to the general credential.
    platform.body = {"effect": "allow", "credentials": "Secret general-token"}

    credentials, telemetry_credentials = await _get_credentials()

    assert credentials == "Secret general-token"
    assert telemetry_credentials is None


async def test_cache_round_trip_carries_both_credentials(platform):
    platform.body = {
        "effect": "allow",
        "credentials": "Secret general-token",
        "telemetry_credentials": "Secret telemetry-token",
    }

    first = await _get_credentials()
    assert platform.call_count == 1

    second = await _get_credentials()
    # The second identical request is served from the cache, with BOTH values intact.
    assert platform.call_count == 1
    assert first == second == ("Secret general-token", "Secret telemetry-token")


async def test_deny_body_raises(platform):
    platform.body = {"effect": "deny"}

    with pytest.raises(auth_module.DenyException):
        await _get_credentials()
