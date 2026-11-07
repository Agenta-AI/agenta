"""Recovery after a failed resume: on a fresh IDENTIFY the loop reads channel
history after the snapshot taken when the socket closed, and passes each missed
message through the shared step. A resume skips it."""

import json

import httpx
import pytest

from oss.src.core.channels.adapters.discord.adapter import DiscordAdapter
from oss.src.core.channels.dtos import ChannelEventOrigin
from oss.src.tasks.asyncio.channels.discord_socket import DiscordSocket

from . import payloads as p
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


# --- with the real adapter --------------------------------------------------- #


async def test_recovery_reads_pages_after_the_snapshot_through_the_real_adapter():
    channel_id = p.CHANNEL_ID
    stored = p.message("live", message_id="1200000000000000100")
    missed = [
        p.message(f"missed {i}", message_id=str(1200000000000000100 + i))["d"]
        for i in (1, 2)
    ]
    reads = []

    def _discord(request: httpx.Request) -> httpx.Response:
        if request.url.path.endswith(f"/channels/{channel_id}/messages"):
            after = int(request.url.params["after"])
            reads.append(after)
            newer = [m for m in missed if int(m["id"]) > after]
            # Discord answers newest first, without guild_id or channel_type.
            body = [
                {k: v for k, v in m.items() if k not in ("guild_id", "channel_type")}
                for m in reversed(newer)
            ]
            return httpx.Response(200, json=body)
        if request.url.path.endswith(f"/channels/{channel_id}"):
            return httpx.Response(200, json={"id": channel_id, "type": 0})
        return httpx.Response(404, json={"code": 0})

    adapter = DiscordAdapter(
        http_client=httpx.AsyncClient(
            transport=httpx.MockTransport(_discord), base_url="https://discord.test"
        )
    )
    service = FakeChannelsService(adapter)
    socket = _socket(service)
    socket.connection = socket.connection.model_copy(
        update={
            "data": {
                "bot_token": p.BOT_TOKEN,
                "bot_user_id": p.BOT_USER_ID,
                "bot_username": p.BOT_USERNAME,
            }
        }
    )
    service.connections[socket.connection.id] = socket.connection
    socket.receive(json.dumps({"op": 0, **stored}))
    await until(lambda: not socket.tasks)
    assert service.enqueued == ["1200000000000000100"]

    socket.disconnected()
    await _recover(socket)

    assert reads == [1200000000000000100, 1200000000000000102]
    assert service.enqueued == [
        "1200000000000000100",
        "1200000000000000101",
        "1200000000000000102",
    ]
    locator = service.rows[
        (socket.connection.id, "1200000000000000101")
    ].data.external_locator
    assert locator["guild_id"] == p.GUILD_ID
    assert locator["source_channel_id"] == channel_id
