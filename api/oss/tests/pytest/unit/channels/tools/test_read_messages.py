"""`read_messages`: a channel's stored messages first (people from the inbox,
the bot from the outbox), then, on Slack, one live page of older history."""

from uuid import uuid4

import httpx
import pytest

from oss.src.core.channels.adapters.slack.capabilities import (
    fetch_slack_capabilities,
)
from oss.src.core.channels.adapters.telegram.adapter import TelegramAdapter
from oss.src.core.channels.dtos import ChannelKeyGrain, ChannelSpaceKind
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


def _key(channel):
    return compose_external_key(
        fetch_slack_capabilities(),
        ChannelKeyGrain.SPACE,
        {"team": "T1", "channel": channel},
    )


def _slack(*, tools=None):
    artifact_id = uuid4()
    adapter, workspace, transport = make_adapter_and_workspace(bot_user_id="UBOT1")
    workspace.add_channel(id="C1", name="releases", is_member=True)
    workspace.add_channel(id="C2", name="finance", is_member=True)
    dao = FakeToolsDAO()
    connection = dao.seed_connection(
        data={
            "bot_token": "xoxb-fake",
            "bot_user_id": "UBOT1",
            "connection_locator": {"team_id": "T1"},
        }
    )
    dao.seed_agent(
        connection_id=connection.id,
        references={"application": {"id": str(artifact_id)}},
        tools=tools,
    )
    spaces = {
        channel: dao.seed_space(
            connection_id=connection.id,
            locator={"team": "T1", "channel": channel},
            kind=ChannelSpaceKind.TOPIC,
            external_key=_key(channel),
        )
        for channel in ("C1", "C2")
    }
    service = build_tools_service(dao, adapters={"slack": adapter})
    return service, dao, workspace, transport, artifact_id, spaces


async def _read(service, artifact_id, space, **kwargs):
    return await service.read_messages(
        project_id=PROJECT_ID,
        artifact_id=artifact_id,
        destination_id=encode_destination_id(space.id),
        **kwargs,
    )


def _history_calls(transport):
    return [
        r
        for r in transport.requests
        if r.url.path.endswith(("conversations.history", "conversations.replies"))
    ]


async def test_stored_messages_merge_people_and_bot_oldest_first():
    service, dao, _, transport, artifact_id, spaces = _slack()
    space = spaces["C1"]
    for i in range(3):
        dao.seed_inbox(
            space=space,
            text=f"person {i}",
            ts=f"200{i}.000000",
            sender={"id": "U1", "name": "Ada"},
        )
    dao.seed_sent(space=space, text="bot answer", ts="2001.500000")

    page = await _read(service, artifact_id, space, limit=4)

    assert [m.text for m in page.messages] == [
        "person 0",
        "person 1",
        "bot answer",
        "person 2",
    ]
    assert [m.from_bot for m in page.messages] == [False, False, True, False]
    assert page.messages[0].sender_name == "Ada"
    assert _history_calls(transport) == []  # the page was full from storage
    assert page.cursor is not None


async def test_default_limit_is_50_and_max_is_200():
    service, dao, _, _, artifact_id, spaces = _slack()
    for i in range(250):
        dao.seed_inbox(space=spaces["C1"], text=f"m{i}", ts=f"{3000 + i}.000000")

    default = await _read(service, artifact_id, spaces["C1"])
    maximum = await _read(service, artifact_id, spaces["C1"], limit=1000)

    assert len(default.messages) == 50
    assert len(maximum.messages) == 200


async def test_slack_pages_past_stored_messages_with_one_live_call():
    service, dao, workspace, transport, artifact_id, spaces = _slack()
    older = workspace.seed_message(channel="C1", text="before the bot", user="U7")
    stored_ts = workspace.seed_message(channel="C1", text="stored", user="U1")
    dao.seed_inbox(space=spaces["C1"], text="stored", ts=stored_ts)

    page = await _read(service, artifact_id, spaces["C1"], limit=10)

    assert [m.text for m in page.messages] == ["before the bot", "stored"]
    calls = _history_calls(transport)
    assert len(calls) == 1
    assert float(calls[0].url.params["latest"]) == float(stored_ts)
    assert decode_space_ref("msg", page.messages[0].message_id)[1] == older
    assert page.cursor is None  # Slack said there is nothing older


async def test_live_messages_are_not_stored():
    service, dao, workspace, _, artifact_id, spaces = _slack()
    workspace.seed_message(channel="C1", text="live only", user="U7")

    await _read(service, artifact_id, spaces["C1"])

    assert dao.inbox == [] and dao.outbox == {}


async def test_rate_limit_returns_stored_messages_and_retry_note():
    service, dao, _, transport, artifact_id, spaces = _slack()
    dao.seed_inbox(space=spaces["C1"], text="stored", ts="5000.000000")
    transport.force_error(
        "conversations.history",
        error="ratelimited",
        status_code=429,
        headers={"Retry-After": "40"},
    )

    page = await _read(service, artifact_id, spaces["C1"], limit=10)

    assert [m.text for m in page.messages] == ["stored"]
    assert any("Try again in 40 seconds" in note for note in page.notes)
    assert page.cursor is not None  # the older part can be tried again


async def test_result_notes_stored_messages_may_miss_edits():
    service, dao, _, _, artifact_id, spaces = _slack()
    dao.seed_inbox(space=spaces["C1"], text="stored", ts="5000.000000")

    page = await _read(service, artifact_id, spaces["C1"], limit=1)

    assert any("edits or deletions" in note for note in page.notes)


async def test_thread_read_pages_the_whole_thread_from_the_root():
    service, _, workspace, transport, artifact_id, spaces = _slack()
    root = workspace.seed_message(channel="C1", text="root", user="U1")
    for i in range(5):
        workspace.seed_message(channel="C1", text=f"r{i}", user="U2", thread_ts=root)
    workspace.seed_message(channel="C1", text="elsewhere", user="U1")
    thread_id = encode_space_ref("thr", spaces["C1"].id, root)

    first = await _read(
        service, artifact_id, spaces["C1"], thread_id=thread_id, limit=4
    )
    rest = await _read(
        service,
        artifact_id,
        spaces["C1"],
        thread_id=thread_id,
        limit=4,
        cursor=first.cursor,
    )

    texts = [m.text for m in first.messages + rest.messages]
    assert texts == ["root", "r0", "r1", "r2", "r3", "r4"]
    assert rest.cursor is None
    assert {m.thread_id for m in first.messages} == {thread_id}
    assert _history_calls(transport)[0].url.path.endswith("conversations.replies")


async def test_thread_read_falls_back_to_stored_when_slack_limits():
    service, dao, _, transport, artifact_id, spaces = _slack()
    dao.seed_inbox(space=spaces["C1"], text="root", ts="6000.000000")
    dao.seed_inbox(
        space=spaces["C1"], text="reply", ts="6001.000000", thread_ts="6000.000000"
    )
    dao.seed_inbox(space=spaces["C1"], text="elsewhere", ts="6002.000000")
    transport.force_error("conversations.replies", error="ratelimited", status_code=429)
    thread_id = encode_space_ref("thr", spaces["C1"].id, "6000.000000")

    page = await _read(service, artifact_id, spaces["C1"], thread_id=thread_id)

    assert [m.text for m in page.messages] == ["root", "reply"]
    assert any("about a minute" in note for note in page.notes)


async def test_channel_pages_walk_stored_then_live_without_repeats():
    service, dao, workspace, _, artifact_id, spaces = _slack()
    live_ts = [
        workspace.seed_message(channel="C1", text=f"old {i}", user="U7")
        for i in range(4)
    ]
    for i in range(3):
        ts = workspace.seed_message(channel="C1", text=f"new {i}", user="U1")
        dao.seed_inbox(space=spaces["C1"], text=f"new {i}", ts=ts)
    dao.seed_sent(space=spaces["C1"], text="bot", ts="99999.000000")

    seen, cursor = [], None
    for _ in range(10):
        page = await _read(service, artifact_id, spaces["C1"], limit=2, cursor=cursor)
        seen += [m.text for m in page.messages]
        cursor = page.cursor
        if not cursor:
            break

    assert sorted(seen) == sorted(
        ["bot", "new 0", "new 1", "new 2", "old 0", "old 1", "old 2", "old 3"]
    )
    assert len(seen) == len(set(seen))
    assert len(live_ts) == 4


async def test_unreadable_channel_is_refused_without_calling_slack():
    service, dao, _, transport, artifact_id, spaces = _slack(
        tools={"readable_space_keys": [str(_key("C1"))]}
    )

    with pytest.raises(ChannelToolsRefused, match="Reading"):
        await _read(service, artifact_id, spaces["C2"])
    assert _history_calls(transport) == []


async def test_direct_message_space_is_refused():
    service, dao, _, _, artifact_id, spaces = _slack()
    dm = dao.seed_space(
        connection_id=spaces["C1"].connection_id,
        locator={"team": "T1", "channel": "D1"},
        kind=ChannelSpaceKind.PRIVATE,
    )

    with pytest.raises(ChannelToolsRefused, match="Direct messages"):
        await _read(service, artifact_id, dm)


async def test_thread_of_another_channel_is_not_found():
    service, _, _, _, artifact_id, spaces = _slack()

    with pytest.raises(ChannelToolsNotFound):
        await _read(
            service,
            artifact_id,
            spaces["C1"],
            thread_id=encode_space_ref("thr", spaces["C2"].id, "1.0"),
        )


async def test_no_raw_slack_ids_in_output():
    service, dao, workspace, _, artifact_id, spaces = _slack()
    workspace.seed_message(channel="C1", text="live", user="U7")
    dao.seed_inbox(space=spaces["C1"], text="stored", ts="9000.000000")

    page = await _read(service, artifact_id, spaces["C1"])

    assert "9000.000000" not in page.model_dump_json()
    for message in page.messages:
        assert message.sender_name not in ("U1", "U7")
        assert message.message_id.startswith("msg_")
        assert message.thread_id.startswith("thr_")
        assert set(message.model_dump()) == {
            "message_id",
            "thread_id",
            "sender_name",
            "from_bot",
            "text",
            "sent_at",
        }


async def test_telegram_returns_stored_only_with_history_note():
    artifact_id = uuid4()
    calls = []
    client = httpx.AsyncClient(
        base_url="https://api.telegram.org",
        transport=httpx.MockTransport(lambda r: calls.append(r) or httpx.Response(500)),
    )
    dao = FakeToolsDAO()
    connection = dao.seed_connection(channel="telegram", data={"bot_token": "1:x"})
    dao.seed_agent(
        connection_id=connection.id,
        references={"application": {"id": str(artifact_id)}},
    )
    group = dao.seed_space(
        connection_id=connection.id,
        locator={"chat_id": -100},
        kind=ChannelSpaceKind.GROUP,
    )
    dao.seed_inbox(space=group, text="received", ts="7000.000000")
    service = build_tools_service(
        dao, adapters={"telegram": TelegramAdapter(http_client=client)}
    )

    page = await _read(service, artifact_id, group)

    assert [m.text for m in page.messages] == ["received"]
    assert page.messages[0].thread_id is None
    assert any("Telegram does not let bots read chat history" in n for n in page.notes)
    assert page.cursor is None
    assert calls == []


async def test_a_bot_post_fetched_into_the_inbox_is_shown_once_and_hides_nothing():
    """The bot's post was created at 10 and posted at 30; a fetched copy of it
    sits in the inbox at 30, and a person spoke at 20. Paging one message at a
    time must show each of the two messages exactly once."""
    from oss.src.core.channels.adapters.slack.mapping import slack_time
    from oss.src.core.channels.dtos import ChannelEventOrigin

    service, dao, _, transport, artifact_id, spaces = _slack()
    space = spaces["C1"]
    dao.seed_sent(
        space=space, text="bot post", ts="30.000000", created_at=slack_time("10.0")
    )
    dao.seed_inbox(
        space=space, text="bot post", ts="30.000000", origin=ChannelEventOrigin.PULLED
    )
    dao.seed_inbox(space=space, text="person", ts="20.000000")
    transport.force_error("conversations.history", error="missing_scope")
    transport.force_error("conversations.history", error="missing_scope")
    transport.force_error("conversations.history", error="missing_scope")

    seen, cursor = [], None
    for _ in range(5):
        page = await _read(service, artifact_id, space, limit=1, cursor=cursor)
        seen += [m.text for m in page.messages]
        cursor = page.cursor
        if not cursor:
            break

    assert sorted(seen) == ["bot post", "person"]


async def test_a_rate_limited_thread_page_keeps_its_cursor():
    service, _, workspace, transport, artifact_id, spaces = _slack()
    root = workspace.seed_message(channel="C1", text="root", user="U1")
    for i in range(4):
        workspace.seed_message(channel="C1", text=f"r{i}", user="U2", thread_ts=root)
    thread_id = encode_space_ref("thr", spaces["C1"].id, root)
    first = await _read(
        service, artifact_id, spaces["C1"], thread_id=thread_id, limit=2
    )
    transport.force_error("conversations.replies", error="ratelimited", status_code=429)

    limited = await _read(
        service,
        artifact_id,
        spaces["C1"],
        thread_id=thread_id,
        limit=2,
        cursor=first.cursor,
    )
    resumed = await _read(
        service,
        artifact_id,
        spaces["C1"],
        thread_id=thread_id,
        limit=2,
        cursor=limited.cursor,
    )

    assert limited.messages == [] and limited.cursor == first.cursor
    assert [m.text for m in resumed.messages] == ["r1", "r2"]
