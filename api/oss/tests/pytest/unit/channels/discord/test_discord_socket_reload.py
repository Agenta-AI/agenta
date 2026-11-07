"""The reload opens a socket for a new connection, restarts it when the bot
token changes, and closes it when the connection is archived or switched off."""

import asyncio
from datetime import datetime, timezone

import discord
import pytest

from oss.src.tasks.asyncio.channels import discord_socket
from oss.src.tasks.asyncio.channels.discord_socket import DiscordSocketLoop

from .socket_fakes import FakeChannelsService, FakeClient, connection, fast, until


@pytest.fixture(autouse=True)
def _reset():
    FakeClient.reset()


def _loop(service):
    return DiscordSocketLoop(channels_service=service, client_factory=FakeClient)


async def test_new_connection_opens_a_socket_with_its_token():
    service = FakeChannelsService()
    conn = service.add(connection(token="token-1"))
    loop = _loop(service)

    await loop.reload()
    await until(lambda: FakeClient.instances and FakeClient.instances[0].tokens)

    assert list(loop.sockets) == [conn.id]
    assert FakeClient.instances[0].tokens == ["token-1"]
    await loop.close_all()


async def test_unchanged_connection_is_not_read_again():
    service = FakeChannelsService()
    service.add(connection())
    loop = _loop(service)

    await loop.reload()
    await until(lambda: FakeClient.instances)
    await loop.reload()

    assert len(service.fetches) == 1
    assert len(FakeClient.instances) == 1
    await loop.close_all()


async def test_token_rotation_restarts_the_socket():
    service = FakeChannelsService()
    conn = service.add(connection(token="token-1"))
    loop = _loop(service)
    await loop.reload()
    await until(lambda: FakeClient.instances and FakeClient.instances[0].tokens)

    service.connections[conn.id] = conn.model_copy(
        update={
            "data": {"bot_token": "token-2"},
            "updated_at": datetime(2026, 11, 8, tzinfo=timezone.utc),
        }
    )
    await loop.reload()
    await until(
        lambda: len(FakeClient.instances) == 2 and FakeClient.instances[1].tokens
    )

    assert FakeClient.instances[0].closed.is_set()
    assert FakeClient.instances[1].tokens == ["token-2"]
    await loop.close_all()


async def test_rename_keeps_the_socket():
    service = FakeChannelsService()
    conn = service.add(connection(token="token-1"))
    loop = _loop(service)
    await loop.reload()
    await until(lambda: FakeClient.instances)

    service.connections[conn.id] = conn.model_copy(
        update={
            "name": "renamed",
            "updated_at": datetime(2026, 11, 8, tzinfo=timezone.utc),
        }
    )
    await loop.reload()

    assert len(FakeClient.instances) == 1
    assert not FakeClient.instances[0].closed.is_set()
    # The open socket parses with the edited row.
    assert loop.sockets[conn.id].connection.name == "renamed"
    await loop.close_all()


async def test_archived_connection_closes_its_socket():
    service = FakeChannelsService()
    conn = service.add(connection())
    loop = _loop(service)
    await loop.reload()
    await until(lambda: FakeClient.instances)

    del service.connections[conn.id]
    await loop.reload()

    assert loop.sockets == {}
    assert FakeClient.instances[0].closed.is_set()


async def test_no_registered_adapter_opens_nothing():
    service = FakeChannelsService()
    service.add(connection())
    service.adapter_registry.adapter = None
    loop = _loop(service)

    await loop.reload()

    assert loop.sockets == {}
    assert FakeClient.instances == []


async def test_intent_refusal_logs_and_backs_off_while_others_stay_open(
    monkeypatch,
):
    fast(monkeypatch, tick=0.05)
    errors = []
    monkeypatch.setattr(
        discord_socket.log, "error", lambda message, **kw: errors.append(message)
    )
    service = FakeChannelsService()
    service.add(connection(token="refused"))
    loop = _loop(service)
    FakeClient.failures = [discord.PrivilegedIntentsRequired(None)] * 10

    await loop.reload()
    [refused] = list(loop.sockets.values())
    await until(lambda: len(FakeClient.instances) >= 2)
    await asyncio.sleep(0.1)

    # 0.05s, then 0.1s, then 0.2s between attempts: no tight loop.
    assert len(FakeClient.instances) <= 3
    assert any("4014" in message for message in errors)

    FakeClient.failures = []
    other = service.add(connection(token="ok"))
    await loop.reload()
    assert other.id in loop.sockets
    assert not loop.sockets[other.id].task.done()
    assert not refused.task.done()
    await loop.close_all()
