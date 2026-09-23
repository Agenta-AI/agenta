"""`ChannelsService.describe_connection_restore` -- the unarchive-response
notice. Mirrors `describe_connection_teardown` (see
`test_channels_slack_hosted_lifecycle.py`): a Telegram BYO connection's
webhook is torn down on archive (`revoke_installation`, tested in
`telegram/test_telegram_adapter.py`) and must be re-registered on a bare
unarchive, since that restore path does not resubmit credentials the way a
`create_connection` reconnect or an `edit_connection` rotation does.
"""

import json
from unittest.mock import AsyncMock, MagicMock
from uuid import uuid4

import httpx
import pytest

from oss.src.core.channels.adapters.registry import ChannelAdapterRegistry
from oss.src.core.channels.adapters.telegram.adapter import TelegramAdapter
from oss.src.core.channels.dtos import ChannelConnection, ChannelConnectionFlags
from oss.src.core.channels.service import ChannelsService

pytestmark = pytest.mark.asyncio


def _telegram_adapter_with_capture() -> tuple[TelegramAdapter, list]:
    """A TelegramAdapter whose httpx client is a MockTransport answering the
    Bot API ok-shape, so activate_connection's setWebhook never reaches the
    real network."""

    seen: list = []

    def handler(request: httpx.Request) -> httpx.Response:
        seen.append(request)
        return httpx.Response(200, json={"ok": True, "result": True})

    client = httpx.AsyncClient(
        base_url="https://api.telegram.org", transport=httpx.MockTransport(handler)
    )
    return TelegramAdapter(http_client=client), seen


def _connection(**overrides) -> ChannelConnection:
    fields = dict(
        id=uuid4(),
        slug="telegram-conn",
        channel="telegram",
        external_key=uuid4(),
        name="Support bot",
        data={
            "bot_token": "123:abc",
            "bot_id": "4242",
            "webhook_secret": "s3cr3t",
        },
        flags=ChannelConnectionFlags(is_active=True, is_verified=True),
    )
    fields.update(overrides)
    return ChannelConnection(**fields)


def _service(*, adapter=None) -> ChannelsService:
    adapter = adapter or TelegramAdapter()
    registry = ChannelAdapterRegistry(adapters={adapter.channel: adapter})
    return ChannelsService(channels_dao=MagicMock(), adapter_registry=registry)


async def test_restore_notice_is_generic_for_a_non_telegram_channel():
    connection = _connection(channel="slack", data={"team_id": "T1"})
    adapter = MagicMock()
    adapter.channel = "slack"
    service = _service(adapter=adapter)

    notice = await service.describe_connection_restore(
        project_id=uuid4(), connection=connection
    )

    assert "nothing changed on the platform" in notice
    adapter.activate_connection.assert_not_called()


async def test_restore_re_registers_the_telegram_webhook(monkeypatch):
    from oss.src.utils.env import env

    monkeypatch.setattr(env.agenta, "api_url", "https://pub.example/api")
    real_adapter, seen = _telegram_adapter_with_capture()
    adapter = AsyncMock(wraps=real_adapter)
    adapter.channel = "telegram"
    connection = _connection()
    service = _service(adapter=adapter)
    # No credential_secret_id on this row, so _hydrate_connection is a no-op
    # and returns the connection's own data straight through.

    notice = await service.describe_connection_restore(
        project_id=uuid4(), connection=connection
    )

    adapter.activate_connection.assert_awaited_once()
    call = adapter.activate_connection.await_args.kwargs
    assert call["credentials"] == {
        "bot_token": "123:abc",
        "webhook_secret": "s3cr3t",
    }
    assert seen[0].url.path == "/bot123:abc/setWebhook"
    # activate_connection always sets drop_pending_updates, whether this is a
    # fresh connect or a restore -- a stale queue from before the archive
    # must never replay into the reconnected bot.
    body = json.loads(seen[0].content.decode())
    assert body["drop_pending_updates"] is True
    assert "re-registered" in notice
    assert "dropped, not queued for replay" in notice


async def test_restore_hydrates_vault_credentials_before_re_registering(monkeypatch):
    from oss.src.utils.env import env

    monkeypatch.setattr(env.agenta, "api_url", "https://pub.example/api")
    connection = _connection(
        data={"bot_id": "4242", "credential_secret_id": str(uuid4())}
    )
    hydrated = _connection(
        data={
            "bot_id": "4242",
            "bot_token": "123:vault",
            "webhook_secret": "vault-secret",
        }
    )
    real_adapter, seen = _telegram_adapter_with_capture()
    adapter = AsyncMock(wraps=real_adapter)
    adapter.channel = "telegram"
    service = _service(adapter=adapter)
    service._hydrate_connection = AsyncMock(return_value=hydrated)

    await service.describe_connection_restore(project_id=uuid4(), connection=connection)

    adapter.activate_connection.assert_awaited_once_with(
        connection=hydrated,
        credentials={"bot_token": "123:vault", "webhook_secret": "vault-secret"},
    )
    assert seen[0].url.path == "/bot123:vault/setWebhook"


async def test_restore_never_fails_an_unarchive_that_already_happened():
    """The row is unarchived before the notice is built. A re-registration
    that raises (a revoked bot token, a network error) must not turn the
    finished restore into a 500 the client reads as a failure."""

    connection = _connection()
    adapter = AsyncMock()
    adapter.channel = "telegram"
    adapter.activate_connection.side_effect = RuntimeError("token revoked")
    service = _service(adapter=adapter)

    notice = await service.describe_connection_restore(
        project_id=uuid4(), connection=connection
    )

    assert "Unarchived on our side" in notice
    assert "failed" in notice
