"""`send_message`: post through the bot that owns the destination, with a
delivery record written before the provider call and a truthful state."""

import json
from uuid import uuid4

import httpx
import pytest

from oss.src.core.channels.adapters.slack.capabilities import (
    fetch_slack_capabilities,
)
from oss.src.core.channels.adapters.telegram.adapter import TelegramAdapter
from oss.src.core.channels.dtos import (
    ChannelDeliveryState,
    ChannelKeyGrain,
    ChannelSpaceKind,
)
from oss.src.core.channels.tools import service as tools_service_module
from oss.src.core.channels.tools.ids import (
    decode_space_ref,
    encode_destination_id,
    encode_space_ref,
)
from oss.src.core.channels.tools.types import (
    ChannelToolsNotFound,
    ChannelToolsRefused,
)
from oss.src.core.channels.utils import compose_external_key
from oss.tests.pytest.unit.channels.slack.fake_slack import make_adapter_and_workspace

from .fakes import PROJECT_ID, FakeToolsDAO, build_tools_service

pytestmark = pytest.mark.asyncio


@pytest.fixture(autouse=True)
def _fresh_member_cache():
    tools_service_module._MEMBER_CACHE.clear()
    yield
    tools_service_module._MEMBER_CACHE.clear()


def _slack(*, tools=None):
    artifact_id = uuid4()
    adapter, workspace, transport = make_adapter_and_workspace()
    workspace.add_channel(id="C1", name="releases", is_member=True)
    workspace.add_channel(id="C2", name="support", is_member=True)
    dao = FakeToolsDAO()
    connection = dao.seed_connection()
    dao.seed_agent(
        connection_id=connection.id,
        references={"application": {"id": str(artifact_id)}},
        tools=tools,
    )
    spaces = {}
    for channel in ("C1", "C2"):
        spaces[channel] = dao.seed_space(
            connection_id=connection.id,
            # a space first met through a threaded message keeps that thread
            locator={"team": "T1", "channel": channel, "thread_ts": "5.0"},
            kind=ChannelSpaceKind.TOPIC,
            external_key=compose_external_key(
                fetch_slack_capabilities(),
                ChannelKeyGrain.SPACE,
                {"team": "T1", "channel": channel},
            ),
        )
    service = build_tools_service(dao, adapters={"slack": adapter})
    return service, dao, workspace, transport, artifact_id, spaces


async def _send(service, artifact_id, space, *, call="toolu_1", **kwargs):
    return await service.send_message(
        project_id=PROJECT_ID,
        artifact_id=artifact_id,
        session_id="session-1",
        tool_call_id=call,
        destination_id=encode_destination_id(space.id),
        text=kwargs.pop("text", "QA hello"),
        **kwargs,
    )


def _posts(transport):
    return [r for r in transport.requests if r.url.path.endswith("chat.postMessage")]


async def test_sent_result_has_message_and_thread_ids_and_posts_top_level():
    service, dao, workspace, transport, artifact_id, spaces = _slack()

    result = await _send(service, artifact_id, spaces["C1"])

    assert result.state == "sent"
    posted = json.loads(_posts(transport)[0].content)
    assert posted["channel"] == "C1"
    assert "thread_ts" not in posted  # the space's own thread is not a target
    ts = next(iter(workspace.messages["C1"]))
    assert decode_space_ref("msg", result.message_id) == (spaces["C1"].id, ts)
    assert decode_space_ref("thr", result.thread_id) == (spaces["C1"].id, ts)
    row = next(iter(dao.outbox.values()))
    assert row.state is ChannelDeliveryState.SENT
    assert row.thread_id is None and row.space_id == spaces["C1"].id
    assert result.delivery_id == str(row.id)


async def test_reply_in_a_thread_from_an_earlier_send():
    service, _, workspace, transport, artifact_id, spaces = _slack()
    first = await _send(service, artifact_id, spaces["C1"])

    reply = await _send(
        service, artifact_id, spaces["C1"], call="toolu_2", thread_id=first.thread_id
    )

    assert reply.state == "sent"
    posted = json.loads(_posts(transport)[1].content)
    assert posted["thread_ts"] == decode_space_ref("thr", first.thread_id)[1]
    assert reply.thread_id == first.thread_id


async def test_thread_from_another_destination_is_refused():
    service, _, _, transport, artifact_id, spaces = _slack()
    foreign_thread = encode_space_ref("thr", spaces["C2"].id, "7.0")

    with pytest.raises(ChannelToolsNotFound):
        await _send(service, artifact_id, spaces["C1"], thread_id=foreign_thread)
    assert _posts(transport) == []


async def test_posting_off_refuses_without_calling_the_adapter():
    service, _, _, transport, artifact_id, spaces = _slack(
        tools={"can_post_outside_conversation": False}
    )

    with pytest.raises(ChannelToolsRefused, match="turned off"):
        await _send(service, artifact_id, spaces["C1"])
    assert _posts(transport) == []


async def test_retry_with_same_tool_call_returns_first_outcome():
    service, dao, _, transport, artifact_id, spaces = _slack()

    first = await _send(service, artifact_id, spaces["C1"])
    again = await _send(service, artifact_id, spaces["C1"])

    assert again == first
    assert len(_posts(transport)) == 1
    assert len(dao.outbox) == 1


async def test_unknown_outcome_is_returned_and_not_reposted():
    service, _, _, transport, artifact_id, spaces = _slack()
    transport.force_error("chat.postMessage", error="internal_error", status_code=503)

    first = await _send(service, artifact_id, spaces["C1"])
    again = await _send(service, artifact_id, spaces["C1"])

    assert first.state == "unknown" and again.state == "unknown"
    assert len(_posts(transport)) == 1


async def test_provider_refusal_fails_with_a_sanitized_reason():
    service, _, _, transport, artifact_id, spaces = _slack()
    transport.force_error("chat.postMessage", error="not_in_channel")

    result = await _send(service, artifact_id, spaces["C1"])

    assert result.state == "failed"
    assert result.reason == "not_in_channel"
    assert "xoxb" not in result.model_dump_json()


async def test_unknown_or_foreign_destination_is_not_found():
    service, dao, _, transport, artifact_id, spaces = _slack()
    other = dao.seed_connection()
    foreign = dao.seed_space(
        connection_id=other.id,
        locator={"team": "T9", "channel": "C9"},
        kind=ChannelSpaceKind.TOPIC,
    )

    for destination in (foreign, spaces["C1"].model_copy(update={"id": uuid4()})):
        with pytest.raises(ChannelToolsNotFound):
            await _send(service, artifact_id, destination)
    with pytest.raises(ChannelToolsNotFound):
        await service.send_message(
            project_id=PROJECT_ID,
            artifact_id=artifact_id,
            session_id="s",
            tool_call_id="t",
            destination_id="C1",
            text="x",
        )
    assert _posts(transport) == []


async def test_channel_the_bot_left_is_not_found():
    service, _, workspace, transport, artifact_id, spaces = _slack()
    workspace.channels["C2"]["is_member"] = False

    with pytest.raises(ChannelToolsNotFound):
        await _send(service, artifact_id, spaces["C2"])
    assert _posts(transport) == []


async def test_no_connected_bot_is_refused():
    service, _, _, _, _, spaces = _slack()

    with pytest.raises(ChannelToolsRefused, match="No bot"):
        await _send(service, uuid4(), spaces["C1"])


async def test_archived_connection_is_refused():
    service, dao, _, transport, artifact_id, spaces = _slack()
    dao.archive_connection(next(iter(dao.connections)))

    with pytest.raises(ChannelToolsRefused):
        await _send(service, artifact_id, spaces["C1"])
    assert _posts(transport) == []


def _telegram(handler):
    artifact_id = uuid4()
    client = httpx.AsyncClient(
        base_url="https://api.telegram.org", transport=httpx.MockTransport(handler)
    )
    dao = FakeToolsDAO()
    connection = dao.seed_connection(channel="telegram", data={"bot_token": "1:secret"})
    dao.seed_agent(
        connection_id=connection.id,
        references={"application": {"id": str(artifact_id)}},
    )
    group = dao.seed_space(
        connection_id=connection.id,
        locator={"chat_id": -100, "title": "Ops"},
        kind=ChannelSpaceKind.GROUP,
    )
    service = build_tools_service(
        dao, adapters={"telegram": TelegramAdapter(http_client=client)}
    )
    return service, dao, connection, artifact_id, group


async def test_telegram_group_send_has_no_thread():
    def handler(request):
        body = json.loads(request.content)
        assert body["chat_id"] == -100 and "title" not in body
        return httpx.Response(
            200,
            json={"ok": True, "result": {"message_id": 9, "chat": {"id": -100}}},
        )

    service, _, _, artifact_id, group = _telegram(handler)

    result = await _send(service, artifact_id, group)

    assert result.state == "sent"
    assert result.thread_id is None
    assert decode_space_ref("msg", result.message_id) == (group.id, "9")


async def test_telegram_bot_removed_from_the_group_fails():
    def handler(request):
        return httpx.Response(
            403,
            json={
                "ok": False,
                "error_code": 403,
                "description": "Forbidden: bot was kicked from the supergroup chat",
            },
        )

    service, _, _, artifact_id, group = _telegram(handler)

    result = await _send(service, artifact_id, group)

    assert result.state == "failed"
    assert "kicked" in result.reason
    assert "secret" not in result.model_dump_json()


async def test_revoked_credential_fails_and_switches_connection_off():
    def handler(request):
        return httpx.Response(
            401, json={"ok": False, "error_code": 401, "description": "Unauthorized"}
        )

    service, dao, connection, artifact_id, group = _telegram(handler)

    result = await _send(service, artifact_id, group)

    assert result.state == "failed"
    assert dao.connections[connection.id].flags.is_active is False


async def test_telegram_thread_ids_are_refused():
    service, _, _, artifact_id, group = _telegram(lambda r: httpx.Response(500))

    with pytest.raises(ChannelToolsRefused, match="threads"):
        await _send(
            service,
            artifact_id,
            group,
            thread_id=encode_space_ref("thr", group.id, "1"),
        )


async def test_a_row_another_request_created_is_never_posted_again():
    """A concurrent retry gets the first request's row back from the insert;
    only the request that created the row posts, whatever time has passed."""
    from oss.src.core.channels.dtos import (
        ChannelOutboxEventCreate,
        ChannelOutboxEventData,
    )

    service, dao, _, transport, artifact_id, spaces = _slack()
    key = tools_service_module.send_key(
        session_id="session-1",
        tool_call_id="toolu_1",
        destination_id=encode_destination_id(spaces["C1"].id),
        thread_id=None,
        text="QA hello",
    )
    await dao.record_outbox_event(
        project_id=PROJECT_ID,
        event=ChannelOutboxEventCreate(
            connection_id=spaces["C1"].connection_id,
            space_id=spaces["C1"].id,
            turn_id="toolu_1",
            key=key,
            data=ChannelOutboxEventData(processed={"attempt": "first-request"}),
        ),
    )
    original_fetch = dao.fetch_outbox_event_by_key

    async def raced(**kwargs):  # the retry looked before the first insert landed
        return None

    dao.fetch_outbox_event_by_key = raced
    try:
        result = await _send(service, artifact_id, spaces["C1"])
    finally:
        dao.fetch_outbox_event_by_key = original_fetch

    assert result.state == "unknown"
    assert _posts(transport) == []


async def test_slack_internal_error_is_unknown_not_failed():
    service, _, _, transport, artifact_id, spaces = _slack()
    transport.force_error("chat.postMessage", error="internal_error")

    result = await _send(service, artifact_id, spaces["C1"])

    assert result.state == "unknown"


async def test_a_reused_call_id_with_a_new_message_posts_again():
    service, _, _, transport, artifact_id, spaces = _slack()

    first = await _send(service, artifact_id, spaces["C1"], text="first")
    second = await _send(service, artifact_id, spaces["C1"], text="second")

    assert first.delivery_id != second.delivery_id
    assert len(_posts(transport)) == 2
