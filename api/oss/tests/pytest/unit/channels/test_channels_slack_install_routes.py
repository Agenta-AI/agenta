"""The hosted Slack app's two routes: `install_slack_connection` (redirect
to Slack) and `slack_install_callback` (decode state, then and only then
exchange). Exercised directly against `ChannelsRouter` -- the same class
`entrypoints/routers.py` mounts -- rather than a hand-rolled stand-in, so a
route that never got wired into the real router would fail here too.
"""

from unittest.mock import AsyncMock, patch
from uuid import uuid4

import pytest
from fastapi import FastAPI, HTTPException, Request, status
from fastapi.responses import RedirectResponse

from oss.src.apis.fastapi.channels.router import ChannelsRouter
from oss.src.core.channels.adapters.slack import oauth as slack_oauth
from oss.src.core.gateway.connections.utils import make_oauth_state
from oss.src.utils.env import env

pytestmark = pytest.mark.asyncio


def _make_request(project_id=None, user_id=None, method="GET") -> Request:
    app = FastAPI()
    scope = {
        "type": "http",
        "method": method,
        "path": "/channels/catalog/channels/slack/install/",
        "headers": [],
        "app": app,
    }
    request = Request(scope)
    if project_id is not None:
        request.state.project_id = str(project_id)
    if user_id is not None:
        request.state.user_id = str(user_id)
    return request


def _patched_access(allowed: bool = True):
    return patch(
        "oss.src.apis.fastapi.channels.router.check_action_access",
        new_callable=AsyncMock,
        return_value=allowed,
    )


def _router(service=None) -> ChannelsRouter:
    return ChannelsRouter(
        channels_service=service or AsyncMock(),
        adapter_registry=AsyncMock(keys=lambda: ["slack"]),
    )


def _configure_hosted_app(monkeypatch):
    monkeypatch.setattr(env.channels.slack, "client_id", "cid")
    monkeypatch.setattr(env.channels.slack, "client_secret", "csecret")
    monkeypatch.setattr(env.channels.slack, "signing_secret", "sig")


def _unconfigure_hosted_app(monkeypatch):
    monkeypatch.setattr(env.channels.slack, "client_id", None)
    monkeypatch.setattr(env.channels.slack, "client_secret", None)
    monkeypatch.setattr(env.channels.slack, "signing_secret", None)


# --- install_slack_connection --------------------------------------------------- #


async def test_install_route_refuses_with_a_reason_when_not_configured(monkeypatch):
    _unconfigure_hosted_app(monkeypatch)
    router = _router()
    request = _make_request(project_id=uuid4(), user_id=uuid4())

    with _patched_access(True):
        with pytest.raises(HTTPException) as exc_info:
            await router.install_slack_connection(request)

    # Refuses, not a 500: the deployment simply does not offer the flow.
    assert exc_info.value.status_code != status.HTTP_500_INTERNAL_SERVER_ERROR
    assert exc_info.value.detail


async def test_install_route_requires_edit_channels_permission(monkeypatch):
    _configure_hosted_app(monkeypatch)
    router = _router()
    request = _make_request(project_id=uuid4(), user_id=uuid4())

    with _patched_access(False):
        with pytest.raises(HTTPException) as exc_info:
            await router.install_slack_connection(request)

    assert exc_info.value.status_code == status.HTTP_403_FORBIDDEN


async def test_install_route_redirects_to_slack_with_a_signed_state(monkeypatch):
    _configure_hosted_app(monkeypatch)
    router = _router()
    request = _make_request(project_id=uuid4(), user_id=uuid4())

    with _patched_access(True):
        response = await router.install_slack_connection(request)

    assert isinstance(response, RedirectResponse)
    location = response.headers["location"]
    assert location.startswith("https://slack.com/oauth/v2/authorize?")
    assert "state=" in location
    assert "client_id=cid" in location


# --- slack_install_callback: decode state BEFORE any exchange ----------------- #


async def test_callback_refuses_an_unknown_state_without_exchanging(monkeypatch):
    router = _router()
    request = _make_request()
    exchange = AsyncMock()
    monkeypatch.setattr(slack_oauth, "exchange_code", exchange)

    response = await router.slack_install_callback(
        request, code="some-code", state="not-a-real-token", error=None
    )

    assert response.status_code == 400
    exchange.assert_not_awaited()


async def test_callback_refuses_a_tampered_state_without_exchanging(monkeypatch):
    router = _router()
    request = _make_request()
    exchange = AsyncMock()
    monkeypatch.setattr(slack_oauth, "exchange_code", exchange)

    good_state = make_oauth_state(
        project_id=uuid4(), user_id=uuid4(), secret_key=env.agenta.crypt_key
    )
    tampered = good_state[:-1] + ("0" if good_state[-1] != "0" else "1")

    response = await router.slack_install_callback(
        request, code="some-code", state=tampered, error=None
    )

    assert response.status_code == 400
    exchange.assert_not_awaited()


async def test_callback_refuses_an_expired_state_without_exchanging(monkeypatch):
    router = _router()
    request = _make_request()
    exchange = AsyncMock()
    monkeypatch.setattr(slack_oauth, "exchange_code", exchange)

    state = make_oauth_state(
        project_id=uuid4(), user_id=uuid4(), secret_key=env.agenta.crypt_key
    )
    # The state is freshly minted and would otherwise decode fine; shrinking
    # the install flow's own max-age window to nothing is what makes it
    # decode as expired, without touching the process clock.
    monkeypatch.setattr(slack_oauth, "INSTALL_STATE_MAX_AGE_SECONDS", -1)

    response = await router.slack_install_callback(
        request, code="some-code", state=state, error=None
    )

    assert response.status_code == 400
    exchange.assert_not_awaited()


async def test_callback_treats_a_decline_as_cancelled_not_an_error(monkeypatch):
    router = _router()
    request = _make_request()
    exchange = AsyncMock()
    monkeypatch.setattr(slack_oauth, "exchange_code", exchange)

    state = make_oauth_state(
        project_id=uuid4(), user_id=uuid4(), secret_key=env.agenta.crypt_key
    )

    response = await router.slack_install_callback(
        request, code=None, state=state, error="access_denied"
    )

    assert response.status_code == 200
    assert b"cancelled" in response.body.lower()
    exchange.assert_not_awaited()


async def test_callback_exchanges_and_installs_on_a_valid_state_and_code(monkeypatch):
    service = AsyncMock()
    router = _router(service=service)
    request = _make_request()

    state = make_oauth_state(
        project_id=uuid4(), user_id=uuid4(), secret_key=env.agenta.crypt_key
    )
    monkeypatch.setattr(
        slack_oauth,
        "exchange_code",
        AsyncMock(
            return_value=slack_oauth.SlackOAuthExchangeResult(
                ok=True,
                app_id="A1",
                access_token="xoxb-good",
                bot_user_id="UBOT1",
                scope="chat:write,channels:history",
            )
        ),
    )

    response = await router.slack_install_callback(
        request, code="good-code", state=state, error=None
    )

    assert response.status_code == 200
    service.install_connection.assert_awaited_once()
    call_kwargs = service.install_connection.await_args.kwargs
    assert call_kwargs["connection"].credentials == {"bot_token": "xoxb-good"}
    assert call_kwargs["connection"].flags.is_hosted is True
