"""The agent service sends the turn's session to the credential exchange as the query
parameter `session_id`, so the run credential can name it (`run_session_id`)."""

from __future__ import annotations

from types import SimpleNamespace
from typing import Any, Dict, Optional

import pytest

from agenta.sdk.middlewares.routing import auth as auth_module
from agenta.sdk.utils.cache import TTLLRUCache


class _Request:
    def __init__(
        self,
        body: Any = None,
        *,
        path: str = "/services/agent/v0/invoke",
        method: str = "POST",
        headers: Optional[Dict[str, str]] = None,
        baggage: Optional[Dict[str, str]] = None,
    ) -> None:
        self.method = method
        self.url = SimpleNamespace(path=path)
        self._body = body
        self.headers = {
            "authorization": "ApiKey caller-key",
            "content-type": "application/json",
            **(headers or {}),
        }
        self.cookies: Dict[str, str] = {}
        self.state = SimpleNamespace(
            otel={"baggage": {"project_id": "project-1", **(baggage or {})}}
        )
        self.query_params: Dict[str, str] = {}

    async def json(self) -> Any:
        return self._body


class _Client:
    calls: list = []

    async def __aenter__(self):
        return self

    async def __aexit__(self, *args):
        return None

    async def get(self, *args, **kwargs):
        type(self).calls.append(kwargs.get("params"))
        return SimpleNamespace(
            status_code=200,
            headers={},
            json=lambda: {"effect": "allow", "credentials": "Secret t"},
        )


@pytest.fixture
def exchange(monkeypatch):
    monkeypatch.setattr(auth_module, "_AUTH_ENABLED", True)
    monkeypatch.setattr(auth_module, "_CACHE_ENABLED", True)
    monkeypatch.setattr(auth_module, "_cache", TTLLRUCache())
    _Client.calls = []
    monkeypatch.setattr(auth_module.httpx, "AsyncClient", _Client)
    return _Client


async def _params(exchange, request) -> Dict[str, Any]:
    await auth_module.get_credentials(request, "http://agenta.test")
    return exchange.calls[-1]


async def test_a_turn_sends_the_session_of_its_body(exchange):
    params = await _params(exchange, _Request({"session_id": "sess-1"}))
    assert params["session_id"] == "sess-1"


async def test_the_body_wins_over_the_header_and_the_baggage(exchange):
    request = _Request(
        {"session_id": "body-1"},
        headers={"x-ag-session-id": "header-1"},
        baggage={"ag.session.id": "baggage-1"},
    )
    assert (await _params(exchange, request))["session_id"] == "body-1"


async def test_a_turn_without_a_body_session_sends_the_header_then_the_baggage(
    exchange,
):
    request = _Request({}, headers={"x-ag-session-id": "header-1"})
    assert (await _params(exchange, request))["session_id"] == "header-1"
    request = _Request({}, baggage={"ag.session.id": "baggage-1"})
    assert (await _params(exchange, request))["session_id"] == "baggage-1"
    request = _Request({}, headers={"baggage": "ag.session.id=raw-1"})
    assert (await _params(exchange, request))["session_id"] == "raw-1"


async def test_a_turn_without_a_session_sends_none(exchange):
    """The running normalizer mints the session later; the credential names none."""
    assert "session_id" not in await _params(exchange, _Request({}))


async def test_a_request_that_is_not_a_turn_sends_none(exchange):
    request = _Request(
        {"session_id": "sess-1"},
        path="/services/agent/v0/inspect",
        headers={"x-ag-session-id": "header-1"},
    )
    assert "session_id" not in await _params(exchange, request)
    request = _Request({"session_id": "sess-1"}, method="GET")
    assert "session_id" not in await _params(exchange, request)


async def test_each_session_gets_its_own_cached_credential(exchange):
    for session_id in ("sess-1", "sess-2", "sess-1"):
        await auth_module.get_credentials(
            _Request({"session_id": session_id}), "http://agenta.test"
        )
    assert [call["session_id"] for call in exchange.calls] == ["sess-1", "sess-2"]


async def test_a_body_without_a_content_type_still_names_the_session(exchange):
    """The invoke route reads such a body as JSON, so the exchange reads it too."""
    request = _Request(
        {"session_id": "body-1"}, headers={"x-ag-session-id": "header-1"}
    )
    del request.headers["content-type"]
    assert (await _params(exchange, request))["session_id"] == "body-1"


async def test_a_set_body_session_never_falls_back_to_the_header(exchange):
    """The invoke prelude keeps a body session that is set, even an empty one (the turn
    then fails), so the credential never names the header's session instead."""
    request = _Request({"session_id": ""}, headers={"x-ag-session-id": "header-1"})
    assert "session_id" not in await _params(exchange, request)


async def test_any_content_type_spelling_reads_the_body(exchange):
    request = _Request(
        {"session_id": "body-1"},
        headers={"content-type": "Application/JSON", "x-ag-session-id": "header-1"},
    )
    assert (await _params(exchange, request))["session_id"] == "body-1"
