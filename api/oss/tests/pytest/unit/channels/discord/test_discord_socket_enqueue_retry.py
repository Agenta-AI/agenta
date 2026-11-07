"""Each gateway event goes through `parse_event` and the shared store-and-enqueue
step. A failed enqueue is retried with the same event while the socket keeps
reading."""

import pytest

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
