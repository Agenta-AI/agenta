"""`search_messages`: stored messages of the channels the agent may read at
call time. Never a provider call; every result says what it searched."""

from uuid import uuid4

import httpx
import pytest

from oss.src.core.channels.adapters.slack.capabilities import (
    fetch_slack_capabilities,
)
from oss.src.core.channels.adapters.telegram.adapter import TelegramAdapter
from oss.src.core.channels.dtos import (
    ChannelEventOrigin,
    ChannelKeyGrain,
    ChannelSpaceKind,
)
from oss.src.core.channels.tools import service as tools_service_module
from oss.src.core.channels.tools.ids import (
    decode_destination_id,
    decode_space_ref,
    encode_destination_id,
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
    adapter, workspace, transport = make_adapter_and_workspace()
    workspace.add_channel(id="C1", name="support", is_member=True)
    workspace.add_channel(id="C2", name="finance", is_member=True)
    dao = FakeToolsDAO()
    connection = dao.seed_connection()
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
    dm = dao.seed_space(
        connection_id=connection.id,
        locator={"team": "T1", "channel": "D1"},
        kind=ChannelSpaceKind.PRIVATE,
    )
    dao.seed_inbox(space=spaces["C1"], text="refund policy: 30 days", ts="100.000000")
    dao.seed_inbox(space=spaces["C2"], text="refund budget approved", ts="101.000000")
    dao.seed_inbox(space=dm, text="my refund please", ts="102.000000")
    service = build_tools_service(dao, adapters={"slack": adapter})
    return service, dao, transport, artifact_id, spaces


async def _search(service, artifact_id, query="refund", **kwargs):
    return await service.search_messages(
        project_id=PROJECT_ID, artifact_id=artifact_id, query=query, **kwargs
    )


async def test_search_without_destinations_covers_all_readable_channels():
    service, _, _, artifact_id, spaces = _slack()

    result = await _search(service, artifact_id)

    assert sorted(r.excerpt for r in result.results) == [
        "refund budget approved",
        "refund policy: 30 days",
    ]
    assert {s.name for s in result.searched} == {"support", "finance"}


async def test_narrowed_channel_is_excluded_immediately():
    service, _, _, artifact_id, spaces = _slack(
        tools={"readable_space_keys": [str(_key("C1"))]}
    )

    result = await _search(service, artifact_id)

    assert [r.channel_name for r in result.results] == ["support"]


async def test_reading_off_refuses_search():
    service, _, _, artifact_id, _ = _slack(tools={"readable_space_keys": []})

    with pytest.raises(ChannelToolsRefused, match="search"):
        await _search(service, artifact_id)


async def test_foreign_destination_is_not_found():
    service, dao, _, artifact_id, _ = _slack()

    with pytest.raises(ChannelToolsNotFound):
        await _search(
            service, artifact_id, destination_ids=[encode_destination_id(uuid4())]
        )

    assert dao.searches == []


async def test_a_channel_name_is_not_a_destination_id():
    # staging QA: Haiku passed "#support" and read the empty result as "no match"
    service, dao, _, artifact_id, spaces = _slack()

    with pytest.raises(ChannelToolsNotFound, match="list_channel_destinations"):
        await _search(
            service,
            artifact_id,
            destination_ids=[encode_destination_id(spaces["C1"].id), "#support"],
        )

    assert dao.searches == []


async def test_search_finds_the_bots_own_posts_once():
    service, dao, _, artifact_id, spaces = _slack()
    dao.seed_sent(space=spaces["C1"], text="refund shipped", ts="110.000000")
    # a live read stored a copy of the same post
    dao.seed_inbox(
        space=spaces["C1"],
        text="refund shipped",
        ts="110.000000",
        origin=ChannelEventOrigin.PULLED,
    )

    result = await _search(service, artifact_id, query="shipped")

    assert [r.excerpt for r in result.results] == ["refund shipped"]
    assert decode_space_ref("thr", result.results[0].thread_id) == (
        spaces["C1"].id,
        "110.000000",
    )


async def test_destination_filter_narrows_to_one_channel():
    service, _, _, artifact_id, spaces = _slack()

    result = await _search(
        service,
        artifact_id,
        destination_ids=[encode_destination_id(spaces["C2"].id)],
    )

    assert [r.channel_name for r in result.results] == ["finance"]
    assert decode_destination_id(result.results[0].destination_id) == spaces["C2"].id


async def test_direct_messages_are_never_searched():
    service, dao, _, artifact_id, spaces = _slack()

    result = await _search(service, artifact_id)

    assert "my refund please" not in [r.excerpt for r in result.results]
    searched = set(dao.searches[0]["space_ids"])
    assert searched == {spaces["C1"].id, spaces["C2"].id}


async def test_result_says_searched_messages_since_the_bot_joined():
    service, _, _, artifact_id, _ = _slack()

    result = await _search(service, artifact_id)

    assert {s.coverage for s in result.searched} == {
        "Searched messages since the bot joined this channel."
    }


async def test_search_never_calls_the_provider_for_messages():
    service, _, transport, artifact_id, _ = _slack()

    await _search(service, artifact_id)

    paths = {r.url.path.rsplit("/", 1)[-1] for r in transport.requests}
    assert paths <= {"users.conversations"}  # the member list, never history


async def test_unknown_sender_name_is_omitted_not_raw():
    service, _, _, artifact_id, _ = _slack()

    result = await _search(service, artifact_id)

    assert all(r.sender_name is None for r in result.results)
    assert "U1" not in {r.sender_name for r in result.results}


async def test_results_carry_a_thread_to_read():
    service, _, _, artifact_id, spaces = _slack()

    result = await _search(service, artifact_id, query="policy")

    assert decode_space_ref("thr", result.results[0].thread_id) == (
        spaces["C1"].id,
        "100.000000",
    )


async def test_cursor_pages_without_repeats():
    service, dao, _, artifact_id, spaces = _slack()
    for i in range(5):
        dao.seed_inbox(space=spaces["C1"], text=f"incident {i}", ts=f"20{i}.000000")

    first = await _search(service, artifact_id, query="incident", limit=3)
    second = await _search(
        service, artifact_id, query="incident", limit=3, cursor=first.cursor
    )

    ids = [r.message_id for r in first.results + second.results]
    assert len(ids) == 5 == len(set(ids))
    assert second.cursor is None


async def test_telegram_group_covers_only_messages_the_bot_received():
    artifact_id = uuid4()
    client = httpx.AsyncClient(
        base_url="https://api.telegram.org",
        transport=httpx.MockTransport(lambda r: httpx.Response(500)),
    )
    dao = FakeToolsDAO()
    connection = dao.seed_connection(channel="telegram", data={"bot_token": "1:x"})
    dao.seed_agent(
        connection_id=connection.id,
        references={"application": {"id": str(artifact_id)}},
    )
    group = dao.seed_space(
        connection_id=connection.id,
        locator={"chat_id": -100, "title": "Ops"},
        kind=ChannelSpaceKind.GROUP,
    )
    dao.seed_inbox(space=group, text="refund done", ts="300.000000")
    service = build_tools_service(
        dao, adapters={"telegram": TelegramAdapter(http_client=client)}
    )

    result = await _search(service, artifact_id)

    assert [r.excerpt for r in result.results] == ["refund done"]
    assert result.searched[0].coverage == (
        "Searched only the messages the bot received or sent in this group."
    )
