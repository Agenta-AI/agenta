"""Each gateway event goes through `parse_event` and the shared store-and-enqueue
step. A failed enqueue is retried with the same event while the socket keeps
reading."""

import httpx
import pytest
from sqlalchemy.exc import DBAPIError, IntegrityError, InterfaceError, OperationalError
from sqlalchemy.exc import TimeoutError as PoolTimeoutError

from oss.src.core.channels.types import ChannelInboxEnqueueFailed

from oss.src.tasks.asyncio.channels import discord_socket

from oss.src.tasks.asyncio.channels.discord_socket import DiscordSocket

from .socket_fakes import (
    FakeAdapter,
    FakeChannelsService,
    FakeClient,
    connection,
    fast,
    frame,
    message,
    until,
)


@pytest.fixture(autouse=True)
def _reset():
    FakeClient.reset()


def _socket(service):
    conn = service.add(connection())
    return DiscordSocket(
        project_id=service.project_id,
        connection=conn,
        adapter=service.adapter_registry.get("discord"),
        channels_service=service,
        client_factory=FakeClient,
    )


async def test_message_is_stored_and_enqueued_once():
    service = FakeChannelsService(FakeAdapter())
    socket = _socket(service)

    socket.receive(frame("MESSAGE_CREATE", message("101")))
    await until(lambda: service.enqueued)

    assert service.enqueued == ["101"]
    assert len(service.rows) == 1


async def test_noise_stores_nothing():
    service = FakeChannelsService(FakeAdapter())
    socket = _socket(service)

    socket.receive(frame("TYPING_START", {"channel_id": "C1"}))
    socket.receive('{"op": 11}')
    socket.receive("not json")
    await until(lambda: not socket.tasks)

    assert service.attempts == []


async def test_failed_enqueue_retries_the_same_event_while_reading_continues(
    monkeypatch,
):
    fast(monkeypatch, tick=0.02)
    service = FakeChannelsService(FakeAdapter())
    service.fail_enqueues = 3
    socket = _socket(service)

    socket.receive(frame("MESSAGE_CREATE", message("101")))
    await until(lambda: service.attempts)
    # The socket keeps reading during the retry.
    socket.receive(frame("MESSAGE_CREATE", message("102")))
    await until(lambda: set(service.enqueued) == {"101", "102"})

    assert service.attempts.count("101") + service.attempts.count("102") == 5
    assert service.enqueued.count("101") == 1
    # One stored row per message, however many attempts.
    assert len(service.rows) == 2


async def test_failed_store_retries_the_same_event_while_reading_continues(
    monkeypatch,
):
    fast(monkeypatch, tick=0.02)
    service = FakeChannelsService(FakeAdapter())
    service.fail_stores = 2
    socket = _socket(service)

    socket.receive(frame("MESSAGE_CREATE", message("101")))
    await until(lambda: service.attempts)
    socket.receive(frame("MESSAGE_CREATE", message("102")))
    await until(lambda: set(service.enqueued) == {"101", "102"})

    assert service.attempts.count("101") + service.attempts.count("102") == 4
    assert len(service.rows) == 2


async def test_permanent_store_error_drops_the_event_after_one_try():
    service = FakeChannelsService(FakeAdapter())
    service.refuse = {"101"}
    socket = _socket(service)

    socket.receive(frame("MESSAGE_CREATE", message("101")))
    socket.receive(frame("MESSAGE_CREATE", message("102")))
    await until(lambda: not socket.tasks)

    assert service.attempts.count("101") == 1
    assert service.enqueued == ["102"]


async def test_transient_parse_error_retries_the_live_event(monkeypatch):
    fast(monkeypatch, tick=0.02)
    adapter = FakeAdapter()
    service = FakeChannelsService(adapter)
    socket = _socket(service)
    parse = adapter.parse_event
    failures = [2]

    async def flaky_parse(*, body, connection=None, request=None):
        if failures[0]:
            failures[0] -= 1
            raise httpx.ConnectError("Discord unreachable")
        return await parse(body=body, connection=connection, request=request)

    adapter.parse_event = flaky_parse
    socket.receive(frame("MESSAGE_CREATE", message("101")))
    await until(lambda: service.enqueued)

    assert service.enqueued == ["101"]


async def test_transient_error_past_the_limit_drops_the_live_event(monkeypatch):
    fast(monkeypatch, tick=0.01)
    monkeypatch.setattr(discord_socket, "RETRY_LIMIT_SECONDS", 0.05)
    service = FakeChannelsService(FakeAdapter())
    service.fail_stores = 1000
    socket = _socket(service)

    socket.receive(frame("MESSAGE_CREATE", message("101")))
    await until(lambda: not socket.tasks)

    assert service.enqueued == []
    assert 1 < service.attempts.count("101") < 1000


class _PgError(Exception):
    """What the asyncpg dialect puts in `DBAPIError.orig`: an error with the
    Postgres SQLSTATE."""

    def __init__(self, sqlstate):
        super().__init__(sqlstate)
        self.sqlstate = sqlstate


class _DiscordRefusal(Exception):
    def __init__(self, status_code):
        self.status_code = status_code


@pytest.mark.parametrize(
    "error, transient",
    [
        (ChannelInboxEnqueueFailed(channel="discord", external_id="1"), True),
        (ConnectionError("reset"), True),
        (TimeoutError(), True),
        (httpx.ConnectError("down"), True),
        (OperationalError("insert", {}, Exception("gone")), True),
        (InterfaceError("insert", {}, Exception("closed")), True),
        (DBAPIError("insert", {}, Exception("x"), connection_invalidated=True), True),
        (DBAPIError("insert", {}, Exception("x")), False),
        (IntegrityError("insert", {}, Exception("fk")), False),
        (PoolTimeoutError("no connection free in the pool"), True),
        (DBAPIError("insert", {}, _PgError("57P01")), True),
        (DBAPIError("insert", {}, _PgError("08006")), True),
        (DBAPIError("insert", {}, _PgError("25006")), True),
        (DBAPIError("insert", {}, _PgError("23505")), False),
        (_DiscordRefusal(503), True),
        (_DiscordRefusal(429), True),
        (_DiscordRefusal(403), False),
        (ValueError("bad"), False),
    ],
)
def test_one_rule_says_which_errors_are_transient(error, transient):
    assert discord_socket._is_transient(error) is transient


async def test_pool_checkout_timeout_retries_the_live_event(monkeypatch):
    fast(monkeypatch, tick=0.02)
    service = FakeChannelsService(FakeAdapter())
    socket = _socket(service)
    record = service.record_and_enqueue_inbox_event
    failures = [2]

    async def busy_pool(**kwargs):
        if failures[0]:
            failures[0] -= 1
            raise PoolTimeoutError("QueuePool limit reached")
        return await record(**kwargs)

    service.record_and_enqueue_inbox_event = busy_pool
    socket.receive(frame("MESSAGE_CREATE", message("101")))
    await until(lambda: service.enqueued)

    assert service.enqueued == ["101"]
