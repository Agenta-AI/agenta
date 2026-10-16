"""The live view: the runner lookup, and the checks the WebSocket route runs before it relays."""

from typing import ClassVar

import httpx
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from oss.src.apis.fastapi.browser import router as browser_router
from oss.src.core.browser import runner_client
from oss.src.core.browser.runner_client import fetch_live_link
from starlette.websockets import WebSocketDisconnect

PROJECT_ID = "019a0000-0000-7000-8000-000000000001"


class _FakeClient:
    """Stands in for `httpx.AsyncClient`; records the request and answers with `response`."""

    response: httpx.Response
    seen: ClassVar[list] = []

    def __init__(self, *args, **kwargs):
        pass

    async def __aenter__(self):
        return self

    async def __aexit__(self, *exc):
        return False

    async def post(self, url, json, headers):
        _FakeClient.seen.append((url, json, headers))
        return _FakeClient.response


@pytest.fixture
def runner(monkeypatch):
    _FakeClient.seen = []
    monkeypatch.setattr(runner_client.httpx, "AsyncClient", _FakeClient)
    return _FakeClient


async def test_returns_the_link_the_runner_found(runner):
    link = {
        "url": "wss://8790-sb.proxy/live",
        "headers": {"x-agenta-browser-token": "t"},
    }
    runner.response = httpx.Response(200, json=link)
    got = await fetch_live_link(
        project_id=PROJECT_ID, session_id="s1", base_url="http://runner/", token="rt"
    )
    assert got == link
    url, body, headers = runner.seen[0]
    assert url == "http://runner/browser/live"
    assert body == {"projectId": PROJECT_ID, "sessionId": "s1"}
    assert headers == {"Authorization": "Bearer rt"}


async def test_no_browser_is_none(runner):
    runner.response = httpx.Response(404, json={"ok": False})
    assert (
        await fetch_live_link(
            project_id=PROJECT_ID, session_id="s1", base_url="http://r", token="t"
        )
        is None
    )


async def test_no_runner_configured_is_none(runner):
    assert (
        await fetch_live_link(
            project_id=PROJECT_ID, session_id="s1", base_url="", token=""
        )
        is None
    )
    assert runner.seen == []


def _client():
    app = FastAPI()
    app.include_router(browser_router.BrowserRouter().router, prefix="/browser")
    return TestClient(app)


def test_websocket_from_another_site_is_refused(monkeypatch):
    monkeypatch.setattr(
        browser_router, "_allowed_origins", lambda: ["https://app.example"]
    )
    with (
        pytest.raises(WebSocketDisconnect) as closed,
        _client().websocket_connect(
            "/browser/live?session_id=s1", headers={"origin": "https://evil.example"}
        ) as ws,
    ):
        ws.receive_text()
    assert closed.value.code == 4403


def test_websocket_without_a_sign_in_is_refused(monkeypatch):
    monkeypatch.setattr(
        browser_router, "_allowed_origins", lambda: ["https://app.example"]
    )

    async def no_auth(request):
        raise RuntimeError("no credentials")

    monkeypatch.setattr(browser_router, "authenticate_connection", no_auth)
    with (
        pytest.raises(WebSocketDisconnect) as closed,
        _client().websocket_connect(
            "/browser/live?session_id=s1", headers={"origin": "https://app.example"}
        ) as ws,
    ):
        ws.receive_text()
    assert closed.value.code == 4401


def test_websocket_with_no_running_browser_closes_with_4404(monkeypatch):
    monkeypatch.setattr(
        browser_router, "_allowed_origins", lambda: ["https://app.example"]
    )

    async def signed_in(request):
        request.state.project_id = PROJECT_ID
        request.state.user_id = "019a0000-0000-7000-8000-000000000002"

    async def allowed(request, permission):
        return True

    async def no_link(**kwargs):
        return None

    monkeypatch.setattr(browser_router, "authenticate_connection", signed_in)
    monkeypatch.setattr(browser_router, "_allowed", allowed)
    monkeypatch.setattr(browser_router, "fetch_live_link", no_link)
    with (
        pytest.raises(WebSocketDisconnect) as closed,
        _client().websocket_connect(
            "/browser/live?session_id=s1", headers={"origin": "https://app.example"}
        ) as ws,
    ):
        ws.receive_text()
    assert closed.value.code == 4404
