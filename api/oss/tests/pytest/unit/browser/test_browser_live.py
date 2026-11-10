"""The live view: the runner lookup, the status route, and the WebSocket route's checks and relay."""

import asyncio
import os
import subprocess
import sys
from pathlib import Path
from typing import ClassVar

import httpx
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from oss.src.apis.fastapi.browser import router as browser_router
from oss.src.core.sessions.streams import runner_client
from oss.src.core.sessions.streams.runner_client import (
    BrowserLiveLink,
    BrowserPage,
    fetch_browser_live_link,
)
from oss.src.utils.env import env
from starlette.websockets import WebSocketDisconnect

PROJECT_ID = "019a0000-0000-7000-8000-000000000001"
ORIGIN = "https://app.example"
PAGE = BrowserPage(wait_reason="Sign in", url="https://example.com/")
LINK = BrowserLiveLink(
    url="wss://8790-sb.proxy/live", headers={"x-agenta-browser-token": "t"}, page=PAGE
)


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
    monkeypatch.setattr(env.runner, "internal_url", "http://runner/")
    monkeypatch.setattr(env.runner, "token", "rt")
    return _FakeClient


async def test_returns_the_link_the_runner_found(runner):
    runner.response = httpx.Response(
        200, json={"url": LINK.url, "headers": LINK.headers, "page": PAGE._asdict()}
    )
    got = await fetch_browser_live_link(project_id=PROJECT_ID, session_id="s1")
    assert got == LINK
    url, body, headers = runner.seen[0]
    assert url == "http://runner/browser/live"
    assert body == {"projectId": PROJECT_ID, "sessionId": "s1"}
    assert headers == {"Authorization": "Bearer rt"}


@pytest.mark.parametrize(
    "page",
    [None, "nope", {"wait_reason": 7, "url": None}, {"url": "x" * 5000}],
)
async def test_a_bad_page_state_keeps_the_link(runner, page):
    runner.response = httpx.Response(
        200, json={"url": LINK.url, "headers": LINK.headers, "page": page}
    )
    got = await fetch_browser_live_link(project_id=PROJECT_ID, session_id="s1")
    assert got.url == LINK.url
    assert got.page.wait_reason == ""
    assert len(got.page.url) <= 2048


@pytest.mark.parametrize(
    "response",
    [
        httpx.Response(404, json={"ok": False}),
        httpx.Response(502, json={"ok": False}),
        httpx.Response(200, text="<html>proxy error</html>"),
        httpx.Response(200, json={"url": 1, "headers": {}}),
    ],
)
async def test_anything_but_a_link_is_none(runner, response):
    runner.response = response
    assert await fetch_browser_live_link(project_id=PROJECT_ID, session_id="s1") is None


async def test_no_runner_configured_is_none(runner, monkeypatch):
    monkeypatch.setattr(env.runner, "internal_url", None)
    assert await fetch_browser_live_link(project_id=PROJECT_ID, session_id="s1") is None
    assert runner.seen == []


@pytest.fixture
def browser_on(monkeypatch):
    monkeypatch.setattr(env.browser, "enabled", True)
    monkeypatch.setattr(env.agenta, "web_url", ORIGIN)
    monkeypatch.setattr(env.agenta, "app_origins", [])


def _client():
    app = FastAPI()
    app.include_router(browser_router.BrowserRouter().router, prefix="/browser")
    return TestClient(app)


def _close_code(path="/browser/live?session_id=s1", origin=ORIGIN) -> int:
    with (
        pytest.raises(WebSocketDisconnect) as closed,
        _client().websocket_connect(path, headers={"origin": origin}) as ws,
    ):
        ws.receive_text()
    return closed.value.code


def _signed_in(monkeypatch, *checks):
    """Signs the socket in; `check_resource_for` answers `checks` in order, then the last one."""
    answers = list(checks)

    async def signed_in(request):
        request.state.project_id = PROJECT_ID
        request.state.user_id = "019a0000-0000-7000-8000-000000000002"
        return object()

    async def check(**kwargs):
        assert kwargs["action"] == browser_router.Permission.RUN_SESSIONS
        return answers.pop(0) if len(answers) > 1 else answers[0]

    monkeypatch.setattr(browser_router, "authenticate_connection", signed_in)
    monkeypatch.setattr(browser_router, "check_resource_for", check)


def test_websocket_with_the_browser_off_closes_with_4404(monkeypatch):
    monkeypatch.setattr(env.browser, "enabled", False)
    assert _close_code() == 4404


def test_websocket_from_another_site_is_refused(browser_on):
    assert _close_code(origin="https://evil.example") == 4403


@pytest.mark.parametrize(
    "origin",
    ["http://localhost:3000", "https://evil.vercel.app", "https://agenta.ai"],
)
def test_websocket_refuses_origins_cors_accepts(browser_on, origin):
    # CORS also trusts these; the socket drives a signed-in browser, so it does not.
    assert _close_code(origin=origin) == 4403


def test_websocket_accepts_an_extra_app_origin(browser_on, monkeypatch):
    monkeypatch.setattr(env.agenta, "app_origins", ["https://apps.example:8443/"])

    async def no_auth(request):
        raise RuntimeError("no credentials")

    monkeypatch.setattr(browser_router, "authenticate_connection", no_auth)
    # Past the origin check, it reaches the sign-in check.
    assert _close_code(origin="https://apps.example:8443") == 4401


def test_websocket_with_a_bad_session_id_closes_with_4400(browser_on):
    assert _close_code("/browser/live?session_id=a/b") == 4400
    assert _close_code("/browser/live") == 4400


def test_websocket_without_a_sign_in_is_refused(browser_on, monkeypatch):
    async def no_auth(request):
        raise RuntimeError("no credentials")

    monkeypatch.setattr(browser_router, "authenticate_connection", no_auth)
    assert _close_code() == 4401


@pytest.mark.parametrize(
    ("check", "code"),
    [
        (browser_router.ResourceCheck.HIDDEN, 4404),
        (browser_router.ResourceCheck.NO_CAPABILITY, 4403),
    ],
)
def test_websocket_without_run_access_is_refused(browser_on, monkeypatch, check, code):
    _signed_in(monkeypatch, check)
    assert _close_code() == code


def test_websocket_with_no_running_browser_closes_with_4404(browser_on, monkeypatch):
    _signed_in(monkeypatch, browser_router.ResourceCheck.ALLOWED)

    async def no_link(**kwargs):
        return None

    monkeypatch.setattr(browser_router, "fetch_browser_live_link", no_link)
    assert _close_code() == 4404


class _FakeUpstream:
    """The browser's live socket: echoes what the viewer sends, with a prefix; "bye" closes it."""

    def __init__(self):
        self.inbox: asyncio.Queue = asyncio.Queue()
        self.connected_to = None

    async def send(self, message):
        await self.inbox.put(None if message == "bye" else f"echo:{message}")

    def __aiter__(self):
        return self

    async def __anext__(self):
        message = await self.inbox.get()
        if message is None:
            raise StopAsyncIteration
        return message


def _fake_connect(upstream):
    class _Connect:
        def __init__(self, url, additional_headers, max_size):
            upstream.connected_to = (url, additional_headers)

        async def __aenter__(self):
            return upstream

        async def __aexit__(self, *exc):
            return False

    return _Connect


def _with_link(monkeypatch, upstream):
    async def link(**kwargs):
        return LINK

    monkeypatch.setattr(browser_router, "fetch_browser_live_link", link)
    monkeypatch.setattr(browser_router, "connect", _fake_connect(upstream))


def test_websocket_relays_both_ways(browser_on, monkeypatch):
    _signed_in(monkeypatch, browser_router.ResourceCheck.ALLOWED)
    upstream = _FakeUpstream()
    _with_link(monkeypatch, upstream)

    with (
        pytest.raises(WebSocketDisconnect) as closed,
        _client().websocket_connect(
            "/browser/live?session_id=s1", headers={"origin": ORIGIN}
        ) as ws,
    ):
        ws.send_text('{"type":"done"}')
        assert ws.receive_text() == 'echo:{"type":"done"}'
        ws.send_text("bye")
        ws.receive_text()
    assert closed.value.code == 1000
    assert upstream.connected_to == (LINK.url, LINK.headers)


def test_websocket_says_no_browser_when_the_upstream_refuses(browser_on, monkeypatch):
    _signed_in(monkeypatch, browser_router.ResourceCheck.ALLOWED)
    _with_link(monkeypatch, _FakeUpstream())

    def refused(*args, **kwargs):
        raise ConnectionError("stale token")

    monkeypatch.setattr(browser_router, "connect", refused)

    with (
        pytest.raises(WebSocketDisconnect) as closed,
        _client().websocket_connect(
            "/browser/live?session_id=s1", headers={"origin": ORIGIN}
        ) as ws,
    ):
        ws.receive_text()
    assert closed.value.code == browser_router._CLOSE_NO_BROWSER


def test_websocket_closes_when_access_is_revoked(browser_on, monkeypatch):
    monkeypatch.setattr(env.sessions, "live_auth_recheck_seconds", 0.05)
    _signed_in(
        monkeypatch,
        browser_router.ResourceCheck.ALLOWED,
        browser_router.ResourceCheck.NO_CAPABILITY,
    )
    _with_link(monkeypatch, _FakeUpstream())

    with (
        pytest.raises(WebSocketDisconnect) as closed,
        _client().websocket_connect(
            "/browser/live?session_id=s1", headers={"origin": ORIGIN}
        ) as ws,
    ):
        ws.receive_text()
    assert closed.value.code == 4403


def test_websocket_survives_a_failed_recheck(browser_on, monkeypatch):
    monkeypatch.setattr(env.sessions, "live_auth_recheck_seconds", 0.02)
    calls = []

    async def signed_in(request):
        request.state.project_id = PROJECT_ID
        return object()

    async def flaky(**kwargs):
        calls.append(1)
        if len(calls) == 2:
            raise RuntimeError("database is gone for a moment")
        return browser_router.ResourceCheck.ALLOWED

    monkeypatch.setattr(browser_router, "authenticate_connection", signed_in)
    monkeypatch.setattr(browser_router, "check_resource_for", flaky)
    _with_link(monkeypatch, _FakeUpstream())
    with (
        pytest.raises(WebSocketDisconnect) as closed,
        _client().websocket_connect(
            "/browser/live?session_id=s1", headers={"origin": ORIGIN}
        ) as ws,
    ):
        while len(calls) < 4:
            ws.send_text("ping")
            assert ws.receive_text() == "echo:ping"
        ws.send_text("bye")
        ws.receive_text()
    assert closed.value.code == 1000


def test_status_with_the_browser_off_is_not_running(monkeypatch):
    monkeypatch.setattr(env.browser, "enabled", False)

    async def must_not_run(**kwargs):
        raise AssertionError("the runner is not asked when the browser is off")

    monkeypatch.setattr(browser_router, "fetch_browser_live_link", must_not_run)
    got = asyncio.run(
        browser_router.BrowserRouter().live_status(
            object(),
            live_status_request=browser_router.BrowserLiveStatusRequest(
                session_id="s1"
            ),
        )
    )
    assert got.running is False


def test_the_browser_skill_is_listed_only_with_the_flag_and_always_resolves():
    probe = (
        "from oss.src.core.workflows.static_catalog import StaticWorkflowCatalog;"
        "c = StaticWorkflowCatalog();"
        "print('__ag__browser' in c.list_slugs(),"
        " c.retrieve_revision(slug='__ag__browser') is not None)"
    )
    api_root = Path(__file__).resolve().parents[5]

    def listed(flag: str) -> str:
        return (
            subprocess.run(
                [sys.executable, "-c", probe],
                cwd=api_root,
                env={**os.environ, "AGENTA_BROWSER_ENABLED": flag},
                capture_output=True,
                text=True,
                check=True,
            )
            .stdout.strip()
            .splitlines()[-1]
        )

    # Listed only with the flag; an agent that embeds it resolves either way.
    assert listed("false") == "False True"
    assert listed("true") == "True True"


def _status(monkeypatch, link, decision=browser_router.ResourceCheck.ALLOWED):
    monkeypatch.setattr(env.browser, "enabled", True)

    async def allow(*args, **kwargs):
        return decision

    async def found(**kwargs):
        return link

    monkeypatch.setattr(browser_router, "check_resource", allow)
    monkeypatch.setattr(browser_router, "fetch_browser_live_link", found)
    request = type("R", (), {"state": type("S", (), {"project_id": PROJECT_ID})()})()
    return asyncio.run(
        browser_router.BrowserRouter().live_status(
            request,
            live_status_request=browser_router.BrowserLiveStatusRequest(
                session_id="019a0000-0000-7000-8000-000000000002"
            ),
        )
    )


def test_status_is_not_running_for_a_person_who_cannot_run_the_session(monkeypatch):
    for decision in (
        browser_router.ResourceCheck.FORBIDDEN,
        browser_router.ResourceCheck.HIDDEN,
    ):
        assert _status(monkeypatch, LINK, decision).running is False


def test_status_carries_the_page_and_the_agents_ask(monkeypatch):
    got = _status(monkeypatch, LINK)
    assert got.model_dump(exclude_none=True) == {
        "running": True,
        "wait_reason": "Sign in",
        "url": "https://example.com/",
    }


def test_status_leaves_out_an_empty_ask(monkeypatch):
    got = _status(monkeypatch, LINK._replace(page=BrowserPage()))
    assert got.model_dump(exclude_none=True) == {"running": True}
