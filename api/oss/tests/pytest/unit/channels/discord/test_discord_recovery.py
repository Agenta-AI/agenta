"""Recovery after a failed resume: on a fresh IDENTIFY the loop reads channel
history after the snapshot taken when the socket closed, and passes each missed
message through the shared step. A resume skips it."""

import pytest

from oss.src.core.channels.dtos import ChannelEventOrigin
from oss.src.tasks.asyncio.channels.discord_socket import DiscordSocket

from .socket_fakes import (
    FakeAdapter,
    FakeChannelsService,
    FakeClient,
    connection,
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


async def _live(socket, service, *messages):
    for item in messages:
        socket.receive(frame("MESSAGE_CREATE", item))
    await until(lambda: not socket.tasks)


async def _recover(socket):
    socket.receive(frame("READY", {"session_id": "s"}))
    await until(lambda: socket.recovery is not None and socket.recovery.done())


async def test_missed_messages_are_stored_and_enqueued_as_pushed():
    adapter = FakeAdapter()
    service = FakeChannelsService(adapter)
    socket = _socket(service)
    await _live(socket, service, message("100", channel_id="C"))

    socket.disconnected()
    adapter.history["C"] = [
        message("100", "C"),
        message("200", "C"),
        message("300", "C"),
    ]
    await _recover(socket)

    assert adapter.history_reads[0] == ("C", "100")
    assert service.enqueued == ["100", "200", "300"]
    # The guild id is put back on each history message.
    row = service.rows[(socket.connection.id, "200")]
    assert row.origin == ChannelEventOrigin.PUSHED
    assert row.data.external_locator["guild_id"] == "G1"
    assert socket.snapshot is None


async def test_live_message_stored_first_does_not_hide_an_earlier_missed_one():
    adapter = FakeAdapter()
    service = FakeChannelsService(adapter)
    socket = _socket(service)
    await _live(socket, service, message("100", channel_id="C"))

    socket.disconnected()
    await until(lambda: socket.snapshot.done())
    # The new socket delivers 300 live before recovery reads channel C.
    await _live(socket, service, message("300", channel_id="C"))
    adapter.history["C"] = [message("200", "C"), message("300", "C")]
    await _recover(socket)

    assert adapter.history_reads[0] == ("C", "100")
    assert (socket.connection.id, "200") in service.rows


async def test_message_delivered_twice_is_stored_once():
    adapter = FakeAdapter()
    service = FakeChannelsService(adapter)
    socket = _socket(service)
    await _live(socket, service, message("100", channel_id="C"))

    socket.disconnected()
    await until(lambda: socket.snapshot.done())
    await _live(socket, service, message("200", channel_id="C"))
    adapter.history["C"] = [message("200", "C")]
    await _recover(socket)

    # The socket and recovery both delivered 200; the unique key keeps one row.
    assert service.attempts.count("200") == 2
    assert len([key for key in service.rows if key[1] == "200"]) == 1


async def test_opening_mention_groups_by_the_delivering_channel():
    adapter = FakeAdapter()
    service = FakeChannelsService(adapter)
    socket = _socket(service)
    inbound = await adapter.parse_event(
        body=frame("MESSAGE_CREATE", message("100", "C")).encode(),
        connection=socket.connection,
    )
    # A mention opens a thread keyed by its own id; it was delivered in C.
    inbound.external_locator.update({"thread_id": "100", "source_channel_id": "C"})
    service.store_row(socket.connection, inbound)

    socket.disconnected()
    adapter.history["C"] = [message("200", "C")]
    await _recover(socket)

    assert adapter.history_reads[0] == ("C", "100")
    assert "200" in service.enqueued


async def test_successful_resume_reads_no_history():
    adapter = FakeAdapter()
    service = FakeChannelsService(adapter)
    socket = _socket(service)
    await _live(socket, service, message("100", channel_id="C"))

    socket.disconnected()
    socket.receive(frame("RESUMED"))

    assert socket.snapshot is None
    assert adapter.history_reads == []


async def test_reconnect_retries_reuse_the_first_snapshot():
    adapter = FakeAdapter()
    service = FakeChannelsService(adapter)
    socket = _socket(service)
    await _live(socket, service, message("100", channel_id="C"))

    socket.disconnected()
    first = socket.snapshot
    socket.disconnected()
    assert socket.snapshot is first
    await until(lambda: first.done())
    assert service.snapshot_queries == 1


async def test_quiet_channel_is_skipped_and_pages_go_forward():
    adapter = FakeAdapter()
    adapter.page_size = 2
    service = FakeChannelsService(adapter)
    socket = _socket(service)
    await _live(socket, service, message("100", channel_id="C"))

    socket.disconnected()
    adapter.history["C"] = [message(str(i), "C") for i in (200, 300, 400)]
    # Q has no stored message in the window, so it has no snapshot entry.
    adapter.history["Q"] = [message("500", "Q")]
    await _recover(socket)

    assert [read[0] for read in adapter.history_reads] == ["C", "C", "C"]
    assert [read[1] for read in adapter.history_reads] == ["100", "300", "400"]
    assert service.enqueued == ["100", "200", "300", "400"]
