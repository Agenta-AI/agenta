"""The hosted app's OAuth mechanics: the authorize URL, the exchange, and
the "not configured" refusal. Identity composition is deliberately NOT
tested here -- that is `verify_connection`'s contract (test_slack_adapter.py)
and this module never reimplements it.
"""

from typing import Any, Dict, List
from urllib.parse import parse_qs, urlparse

import httpx

from oss.src.core.channels.adapters.slack.oauth import (
    build_authorize_url,
    exchange_code,
    hosted_app_configured,
)
from oss.src.utils.env import env


def _configure(monkeypatch, *, client_id="cid", client_secret="csecret", signing="sig"):
    monkeypatch.setattr(env.channels.slack, "client_id", client_id)
    monkeypatch.setattr(env.channels.slack, "client_secret", client_secret)
    monkeypatch.setattr(env.channels.slack, "signing_secret", signing)


# --- hosted_app_configured ----------------------------------------------------- #


def test_hosted_app_configured_is_false_with_nothing_set(monkeypatch):
    monkeypatch.setattr(env.channels.slack, "client_id", None)
    monkeypatch.setattr(env.channels.slack, "client_secret", None)
    monkeypatch.setattr(env.channels.slack, "signing_secret", None)

    assert hosted_app_configured() is False


def test_hosted_app_configured_is_false_with_only_two_of_three_set(monkeypatch):
    monkeypatch.setattr(env.channels.slack, "client_id", "cid")
    monkeypatch.setattr(env.channels.slack, "client_secret", "csecret")
    monkeypatch.setattr(env.channels.slack, "signing_secret", None)

    assert hosted_app_configured() is False


def test_hosted_app_configured_is_true_with_all_three_set(monkeypatch):
    _configure(monkeypatch)

    assert hosted_app_configured() is True


# --- build_authorize_url -------------------------------------------------------- #


def test_authorize_url_carries_client_id_scope_redirect_and_state(monkeypatch):
    _configure(monkeypatch, client_id="cid-123")

    url = build_authorize_url(
        state="signed-state-token",
        redirect_uri="https://agenta.example/channels/catalog/channels/slack/callback/",
    )

    parsed = urlparse(url)
    assert parsed.netloc == "slack.com"
    assert parsed.path == "/oauth/v2/authorize"

    params = parse_qs(parsed.query)
    assert params["client_id"] == ["cid-123"]
    assert params["state"] == ["signed-state-token"]
    assert params["redirect_uri"] == [
        "https://agenta.example/channels/catalog/channels/slack/callback/"
    ]
    assert "chat:write" in params["scope"][0]
    assert "channels:history" in params["scope"][0]


# --- exchange_code ---------------------------------------------------------- #


class _StubTransport(httpx.AsyncBaseTransport):
    def __init__(self, response: Dict[str, Any]):
        self._response = response
        self.requests: List[httpx.Request] = []

    async def handle_async_request(self, request: httpx.Request) -> httpx.Response:
        self.requests.append(request)
        return httpx.Response(200, json=self._response)


async def test_exchange_code_posts_client_credentials_code_and_redirect_uri(
    monkeypatch,
):
    _configure(monkeypatch, client_id="cid", client_secret="csecret")
    transport = _StubTransport({"ok": True, "access_token": "xoxb-x"})
    client = httpx.AsyncClient(transport=transport)

    await exchange_code(
        code="the-code",
        redirect_uri="https://agenta.example/callback/",
        http_client=client,
    )

    sent = parse_qs(transport.requests[0].content.decode())
    assert sent["client_id"] == ["cid"]
    assert sent["client_secret"] == ["csecret"]
    assert sent["code"] == ["the-code"]
    assert sent["redirect_uri"] == ["https://agenta.example/callback/"]


async def test_exchange_code_parses_a_successful_response():
    transport = _StubTransport(
        {
            "ok": True,
            "app_id": "A1",
            "access_token": "xoxb-good",
            "bot_user_id": "UBOT1",
            "scope": "chat:write,channels:history",
            "team": {"id": "T1", "name": "Acme"},
        }
    )
    client = httpx.AsyncClient(transport=transport)

    result = await exchange_code(
        code="c", redirect_uri="https://x/callback/", http_client=client
    )

    assert result.ok is True
    assert result.app_id == "A1"
    assert result.access_token == "xoxb-good"
    assert result.bot_user_id == "UBOT1"
    assert result.scope == "chat:write,channels:history"


async def test_exchange_code_surfaces_slacks_own_error_without_raising():
    """oauth.v2.access returning an error is a normal outcome the caller
    shows as-is, not an exception -- the exchange never writes anything on
    this path."""

    transport = _StubTransport({"ok": False, "error": "invalid_code"})
    client = httpx.AsyncClient(transport=transport)

    result = await exchange_code(
        code="bad", redirect_uri="https://x/callback/", http_client=client
    )

    assert result.ok is False
    assert result.error == "invalid_code"
    assert result.access_token is None
