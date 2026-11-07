"""Recovery after a fresh IDENTIFY: on every READY, the first socket of a
connection included, the loop reads channel history after the last message
stored before READY, and passes each missed message through the shared step.
A resume sends RESUMED, which reads no history."""

import asyncio
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
    fast,
    frame,
    message,
    until,
)


@pytest.fixture(autouse=True)
def _reset(monkeypatch):
    FakeClient.reset()
    fast(monkeypatch)


def _socket(service):
    conn = service.add(connection())
    return DiscordSocket(
        project_id=service.project_id,
        connection=conn,
        adapter=service.adapter_registry.get("discord"),
        channels_service=service,
        client_factory=FakeClient,
    )


async def _live(socket, *messages):
    for item in messages:
        socket.receive(frame("MESSAGE_CREATE", item))
    await until(lambda: not socket.tasks)


async def _ready(socket):
    # Rows stored before READY fall outside the clock margin.
    await asyncio.sleep(0.01)
    socket.receive(frame("READY", {"session_id": "s"}))
    await until(lambda: not socket.tasks)


async def test_missed_messages_are_stored_and_enqueued_as_pushed():
    adapter = FakeAdapter()
    service = FakeChannelsService(adapter)
    socket = _socket(service)
    await _live(socket, message("100", channel_id="C"))

    adapter.history["C"] = [message(i, "C") for i in ("100", "200", "300")]
    await _ready(socket)

    assert adapter.history_reads[0] == ("C", "100")
    assert service.enqueued == ["100", "200", "300"]
    # The guild id is put back on each history message.
    row = service.rows[(socket.connection.id, "200")]
    assert row.origin == ChannelEventOrigin.PUSHED
    assert row.data.external_locator["guild_id"] == "G1"


async def test_live_message_stored_right_after_ready_does_not_hide_a_missed_one():
    adapter = FakeAdapter()
    service = FakeChannelsService(adapter)
    socket = _socket(service)
    await _live(socket, message("100", channel_id="C"))
    await asyncio.sleep(0.01)

    # READY and a live message 300 arrive together; recovery reads after
    # them. 200 was posted during the gap.
    socket.receive(frame("READY", {"session_id": "s"}))
    socket.receive(frame("MESSAGE_CREATE", message("300", channel_id="C")))
    adapter.history["C"] = [message("200", "C"), message("300", "C")]
    await until(lambda: not socket.tasks)

    assert adapter.history_reads[0] == ("C", "100")
    assert (socket.connection.id, "200") in service.rows


async def test_message_delivered_twice_is_stored_and_enqueued_once():
    adapter = FakeAdapter()
    service = FakeChannelsService(adapter)
    socket = _socket(service)
    await _live(socket, message("100", channel_id="C"))
    await asyncio.sleep(0.01)

    gate = asyncio.Event()
    read = adapter.fetch_messages_after

    async def slow_read(**kwargs):
        await gate.wait()
        return await read(**kwargs)

    adapter.fetch_messages_after = slow_read
    adapter.history["C"] = [message("200", "C")]
    socket.receive(frame("READY", {"session_id": "s"}))
    # The new socket delivers 200 before recovery reads channel C.
    socket.receive(frame("MESSAGE_CREATE", message("200", channel_id="C")))
    await until(lambda: service.enqueued.count("200") == 1)
    gate.set()
    await until(lambda: not socket.tasks)

    # The socket and recovery both delivered 200. One row, one dispatch.
    assert service.attempts.count("200") == 2
    assert len([key for key in service.rows if key[1] == "200"]) == 1
    assert service.enqueued.count("200") == 1


async def test_recovered_message_retries_a_failed_enqueue():
    adapter = FakeAdapter()
    service = FakeChannelsService(adapter)
    socket = _socket(service)
    await _live(socket, message("100", channel_id="C"))

    service.fail_enqueues = 2
    adapter.history["C"] = [message("200", "C")]
    await _ready(socket)

    # The row was stored by the first try, so the retries still enqueue it.
    assert service.attempts.count("200") == 3
    assert service.enqueued == ["100", "200"]


async def test_second_gap_during_a_recovery_is_recovered():
    adapter = FakeAdapter()
    service = FakeChannelsService(adapter)
    socket = _socket(service)
    await _live(socket, message("100", channel_id="C"), message("100", "D"))
    gate = asyncio.Event()
    read = adapter.fetch_messages_after

    async def slow_read(*, connection, channel_id, after):
        if channel_id == "D":
            await gate.wait()
        return await read(connection=connection, channel_id=channel_id, after=after)

    adapter.fetch_messages_after = slow_read
    adapter.history["C"] = [message("150", "C")]
    adapter.history["D"] = [message("150", "D")]
    await asyncio.sleep(0.01)
    socket.receive(frame("READY", {"session_id": "1"}))
    await until(lambda: (socket.connection.id, "150") in service.rows)

    # The first pass is still on D. The socket drops again, 400 is posted in
    # C, which the first pass already finished, and the socket identifies.
    adapter.history["C"].append(message("400", "C"))
    await asyncio.sleep(0.01)
    socket.receive(frame("READY", {"session_id": "2"}))
    await until(lambda: (socket.connection.id, "400") in service.rows)
    gate.set()
    await until(lambda: not socket.tasks)

    assert "400" in service.enqueued


async def test_first_socket_after_a_restart_recovers():
    adapter = FakeAdapter()
    service = FakeChannelsService(adapter)
    first = _socket(service)
    await _live(first, message("100", channel_id="C"))

    # The process restarts: a new socket for the same connection, no
    # disconnect seen, then its first READY.
    second = DiscordSocket(
        project_id=service.project_id,
        connection=first.connection,
        adapter=adapter,
        channels_service=service,
        client_factory=FakeClient,
    )
    adapter.history["C"] = [message("200", "C")]
    await _ready(second)

    assert "200" in service.enqueued


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

    adapter.history["C"] = [message("200", "C")]
    await _ready(socket)

    assert adapter.history_reads[0] == ("C", "100")
    assert "200" in service.enqueued


async def test_successful_resume_reads_no_history():
    adapter = FakeAdapter()
    service = FakeChannelsService(adapter)
    socket = _socket(service)
    await _live(socket, message("100", channel_id="C"))

    socket.receive(frame("RESUMED"))
    await until(lambda: not socket.tasks)

    assert adapter.history_reads == []
    assert service.start_queries == 0


async def test_quiet_channel_is_skipped_and_pages_go_forward():
    adapter = FakeAdapter()
    adapter.page_size = 2
    service = FakeChannelsService(adapter)
    socket = _socket(service)
    await _live(socket, message("100", channel_id="C"))

    adapter.history["C"] = [message(str(i), "C") for i in (200, 300, 400)]
    # Q has no stored message in the window, so recovery does not read it.
    adapter.history["Q"] = [message("500", "Q")]
    await _ready(socket)

    assert [read[0] for read in adapter.history_reads] == ["C", "C", "C"]
    assert [read[1] for read in adapter.history_reads] == ["100", "300", "400"]
    assert service.enqueued == ["100", "200", "300", "400"]


async def test_closing_the_socket_keeps_a_pending_enqueue_retry():
    service = FakeChannelsService(FakeAdapter())
    socket = _socket(service)
    socket.open()
    service.fail_enqueues = 3

    socket.receive(frame("MESSAGE_CREATE", message("100", channel_id="C")))
    await until(lambda: service.attempts)
    # The lock is lost, so the loop closes the socket during the retry.
    await socket.close()
    await until(lambda: service.enqueued)

    assert service.enqueued == ["100"]
    assert FakeClient.instances[0].closed.is_set()


# --- with the real adapter --------------------------------------------------- #


async def test_recovery_reads_pages_after_the_start_through_the_real_adapter():
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

    await _ready(socket)

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
