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
    assert call_kwargs["connection"].data["api_app_id"] == "A1"


# --- slack_install_callback: the real seam, router -> service -> adapter ------ #
#
# Replays the shapes Slack returned on the live install that 500'd: the app ID
# arrives only on oauth.v2.access, while auth.test for a bot token carries no
# api_app_id at all. Every layer between the route and the DAO is real, so a
# connection key that cannot be composed fails here the way it failed live.

_LIVE_APP_ID = "A0C15EGPNCQ"
_LIVE_TEAM_ID = "T07UJM0ME8N"


def _live_oauth_v2_access_body() -> dict:
    from oss.src.core.channels.adapters.slack.manifest import SLACK_BOT_SCOPES

    return {
        "ok": True,
        "app_id": _LIVE_APP_ID,
        "authed_user": {"id": "U0INSTALLER"},
        "scope": ",".join(SLACK_BOT_SCOPES),
        "token_type": "bot",
        "access_token": "xoxb-unit-test-not-a-token",
        "bot_user_id": "U0BOTUSER",
        "team": {"id": _LIVE_TEAM_ID, "name": "Agenta QA"},
        "enterprise": None,
        "is_enterprise_install": False,
    }


def _live_auth_test_body() -> dict:
    return {
        "ok": True,
        "url": "https://agenta-qa.slack.com/",
        "team": "Agenta QA",
        "user": "agenta_qa_bot_2",
        "team_id": _LIVE_TEAM_ID,
        "user_id": "U0BOTUSER",
        "bot_id": "B0BOTID",
        "is_enterprise_install": False,
    }


def _slack_transport(*, oauth_body: dict, auth_body: dict):
    import httpx

    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path.endswith("/oauth.v2.access"):
            return httpx.Response(200, json=oauth_body)
        if request.url.path.endswith("/auth.test"):
            return httpx.Response(200, json=auth_body)
        return httpx.Response(404, json={"ok": False, "error": "unknown_method"})

    return httpx.MockTransport(handler)


class _Secret:
    def __init__(self, id):
        self.id = id


class _Vault:
    async def create_secret(self, *, project_id, create_secret_dto):
        return _Secret(uuid4())

    async def update_secret(self, *, secret_id, project_id, update_secret_dto):
        return _Secret(secret_id)


def _real_service(*, transport):
    import httpx
    from unittest.mock import MagicMock

    from oss.src.core.channels.adapters.registry import ChannelAdapterRegistry
    from oss.src.core.channels.adapters.slack.adapter import SlackAdapter
    from oss.src.core.channels.dtos import ChannelConnection
    from oss.src.core.channels.service import ChannelsService

    def _as_connection(created):
        return ChannelConnection(
            id=uuid4(),
            channel=created.channel,
            external_key=created.external_key,
            slug=created.slug,
            name=created.name,
            data=created.data,
            flags=created.flags,
        )

    dao = MagicMock()
    dao.get_project_and_connection_by_external_key = AsyncMock(return_value=None)
    dao.create_connection = AsyncMock(
        side_effect=lambda **kw: _as_connection(kw["connection"])
    )
    adapter = SlackAdapter(
        http_client=httpx.AsyncClient(
            base_url="https://slack.com/api", transport=transport
        )
    )
    service = ChannelsService(
        channels_dao=dao,
        adapter_registry=ChannelAdapterRegistry(adapters={"slack": adapter}),
        vault_service=_Vault(),
    )
    return service, dao


def _patch_exchange_transport(monkeypatch, transport):
    import httpx

    original = slack_oauth.exchange_code

    async def _exchange(**kwargs):
        async with httpx.AsyncClient(transport=transport) as client:
            return await original(http_client=client, **kwargs)

    monkeypatch.setattr(slack_oauth, "exchange_code", _exchange)


async def test_callback_installs_the_live_payload_shape_end_to_end(monkeypatch):
    transport = _slack_transport(
        oauth_body=_live_oauth_v2_access_body(), auth_body=_live_auth_test_body()
    )
    service, dao = _real_service(transport=transport)
    _patch_exchange_transport(monkeypatch, transport)
    router = _router(service=service)
    state = make_oauth_state(
        project_id=uuid4(), user_id=uuid4(), secret_key=env.agenta.crypt_key
    )

    response = await router.slack_install_callback(
        _make_request(), code="live-code", state=state, error=None
    )

    assert response.status_code == 200, response.body
    dao.create_connection.assert_awaited_once()
    created = dao.create_connection.await_args.kwargs["connection"]
    assert created.data["connection_locator"] == {
        "api_app_id": _LIVE_APP_ID,
        "enterprise_id": "",
        "team_id": _LIVE_TEAM_ID,
    }
    assert created.flags.is_hosted is True
    assert created.credentials is None


async def test_callback_refuses_an_exchange_without_an_app_id(monkeypatch):
    oauth_body = _live_oauth_v2_access_body()
    oauth_body.pop("app_id")
    transport = _slack_transport(
        oauth_body=oauth_body, auth_body=_live_auth_test_body()
    )
    service, dao = _real_service(transport=transport)
    _patch_exchange_transport(monkeypatch, transport)
    router = _router(service=service)
    state = make_oauth_state(
        project_id=uuid4(), user_id=uuid4(), secret_key=env.agenta.crypt_key
    )

    response = await router.slack_install_callback(
        _make_request(), code="live-code", state=state, error=None
    )

    assert response.status_code == 502
    assert response.media_type == "text/html"
    dao.create_connection.assert_not_awaited()


async def test_callback_shows_slacks_error_for_a_stale_code(monkeypatch):
    transport = _slack_transport(
        oauth_body={"ok": False, "error": "invalid_code"},
        auth_body=_live_auth_test_body(),
    )
    service, dao = _real_service(transport=transport)
    _patch_exchange_transport(monkeypatch, transport)
    router = _router(service=service)
    state = make_oauth_state(
        project_id=uuid4(), user_id=uuid4(), secret_key=env.agenta.crypt_key
    )

    response = await router.slack_install_callback(
        _make_request(), code="stale-code", state=state, error=None
    )

    assert response.status_code == 400
    assert b"invalid_code" in response.body
    dao.create_connection.assert_not_awaited()


async def test_callback_renders_a_card_not_a_raw_500_on_an_unexpected_failure(
    monkeypatch,
):
    service = AsyncMock()
    service.install_connection.side_effect = RuntimeError("db exploded")
    router = _router(service=service)
    monkeypatch.setattr(
        slack_oauth,
        "exchange_code",
        AsyncMock(
            return_value=slack_oauth.SlackOAuthExchangeResult(
                ok=True, app_id="A1", access_token="xoxb-x", scope="chat:write"
            )
        ),
    )
    state = make_oauth_state(
        project_id=uuid4(), user_id=uuid4(), secret_key=env.agenta.crypt_key
    )

    response = await router.slack_install_callback(
        _make_request(), code="c", state=state, error=None
    )

    assert response.status_code == 500
    assert response.media_type == "text/html"
    assert b"Return to Agenta" in response.body
    assert b"db exploded" not in response.body


async def test_callback_renders_a_card_when_the_exchange_itself_raises(monkeypatch):
    router = _router()
    monkeypatch.setattr(
        slack_oauth, "exchange_code", AsyncMock(side_effect=ValueError("not json"))
    )
    state = make_oauth_state(
        project_id=uuid4(), user_id=uuid4(), secret_key=env.agenta.crypt_key
    )

    response = await router.slack_install_callback(
        _make_request(), code="c", state=state, error=None
    )

    assert response.status_code == 500
    assert response.media_type == "text/html"
