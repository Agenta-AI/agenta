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
    assert decode_space_ref("cur", page.cursor) == (space.id, "2000.000000")


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
    assert calls[0].url.params["latest"] == stored_ts
    assert decode_space_ref("msg", page.messages[0].message_id)[1] == older
    assert page.cursor is None  # the live page came back short: nothing older


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
    assert decode_space_ref("cur", page.cursor)[1] == "5000.000000"


async def test_result_notes_stored_messages_may_miss_edits():
    service, dao, _, _, artifact_id, spaces = _slack()
    dao.seed_inbox(space=spaces["C1"], text="stored", ts="5000.000000")

    page = await _read(service, artifact_id, spaces["C1"], limit=1)

    assert any("edits or deletions" in note for note in page.notes)


async def test_thread_read_returns_root_and_replies():
    service, dao, _, transport, artifact_id, spaces = _slack()
    dao.seed_inbox(space=spaces["C1"], text="root", ts="6000.000000")
    dao.seed_inbox(
        space=spaces["C1"], text="reply", ts="6001.000000", thread_ts="6000.000000"
    )
    dao.seed_inbox(space=spaces["C1"], text="elsewhere", ts="6002.000000")
    thread_id = encode_space_ref("thr", spaces["C1"].id, "6000.000000")

    page = await _read(service, artifact_id, spaces["C1"], thread_id=thread_id)

    assert [m.text for m in page.messages] == ["root", "reply"]
    assert {m.thread_id for m in page.messages} == {thread_id}
    assert _history_calls(transport)[0].url.path.endswith("conversations.replies")


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
