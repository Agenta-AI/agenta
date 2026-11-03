"""`list_destinations`: where the running agent may post, as opaque ids, with
what the bot's settings allow on each."""

from types import SimpleNamespace
from unittest.mock import AsyncMock
from uuid import uuid4

import pytest

from oss.src.core.channels.adapters.slack.capabilities import (
    fetch_slack_capabilities,
)
from oss.src.core.channels.adapters.telegram.adapter import TelegramAdapter
from oss.src.core.channels.adapters.telegram_hosted.adapter import (
    HostedTelegramAdapter,
)
from oss.src.core.channels.dtos import ChannelKeyGrain, ChannelSpaceKind
from oss.src.core.channels.tools import service as tools_service_module
from oss.src.core.channels.tools.ids import decode_destination_id
from oss.src.core.channels.utils import compose_external_key
from oss.tests.pytest.unit.channels.slack.fake_slack import make_adapter_and_workspace

from .fakes import PROJECT_ID, FakeToolsDAO, build_tools_service

pytestmark = pytest.mark.asyncio


@pytest.fixture(autouse=True)
def _fresh_member_cache():
    tools_service_module._MEMBER_CACHE.clear()
    yield
    tools_service_module._MEMBER_CACHE.clear()


def _slack_setup(*, tools=None):
    artifact_id = uuid4()
    adapter, workspace, transport = make_adapter_and_workspace()
    workspace.add_channel(id="C1", name="releases", is_member=True)
    workspace.add_channel(id="C2", name="support", is_member=True, is_private=True)
    workspace.add_channel(id="C3", name="random", is_member=False)
    dao = FakeToolsDAO()
    connection = dao.seed_connection()
    dao.seed_agent(
        connection_id=connection.id,
        references={"application": {"id": str(artifact_id)}},
        tools=tools,
    )
    service = build_tools_service(dao, adapters={"slack": adapter})
    return service, dao, artifact_id, transport


def _slack_key(channel: str):
    return compose_external_key(
        fetch_slack_capabilities(),
        ChannelKeyGrain.SPACE,
        {"team": "T1", "channel": channel},
    )


async def test_slack_lists_member_channels_only():
    service, dao, artifact_id, _ = _slack_setup()

    page = await service.list_destinations(
        project_id=PROJECT_ID, artifact_id=artifact_id
    )

    assert [d.name for d in page.destinations] == ["releases", "support"]
    for destination in page.destinations:
        assert destination.type == "channel"
        assert destination.platform == "slack"
        assert destination.can_post and destination.can_read and destination.can_search
        assert destination.supports_threads
        space = dao.spaces[decode_destination_id(destination.destination_id)]
        assert space.kind is ChannelSpaceKind.TOPIC
        assert "C1" not in destination.destination_id


async def test_listing_reuses_the_space_the_ingress_created():
    service, dao, artifact_id, _ = _slack_setup()
    connection_id = next(iter(dao.connections))
    existing = dao.seed_space(
        connection_id=connection_id,
        locator={"team": "T1", "channel": "C1", "thread_ts": "1.0"},
        kind=ChannelSpaceKind.TOPIC,
        external_key=_slack_key("C1"),
    )

    page = await service.list_destinations(
        project_id=PROJECT_ID, artifact_id=artifact_id
    )

    ids = {decode_destination_id(d.destination_id) for d in page.destinations}
    assert existing.id in ids
    assert len(dao.spaces) == 2


async def test_posting_off_marks_channels_not_postable():
    service, _, artifact_id, _ = _slack_setup(
        tools={"can_post_outside_conversation": False}
    )

    page = await service.list_destinations(
        project_id=PROJECT_ID, artifact_id=artifact_id
    )

    assert page.destinations
    assert all(not d.can_post and d.can_read for d in page.destinations)


async def test_readable_list_sets_can_read_per_channel():
    service, _, artifact_id, _ = _slack_setup(
        tools={"readable_space_keys": [str(_slack_key("C2"))]}
    )

    page = await service.list_destinations(
        project_id=PROJECT_ID, artifact_id=artifact_id
    )

    readable = {d.name: d.can_read for d in page.destinations}
    assert readable == {"releases": False, "support": True}


async def test_name_filter_and_paging():
    service, _, artifact_id, _ = _slack_setup()

    filtered = await service.list_destinations(
        project_id=PROJECT_ID, artifact_id=artifact_id, query="SUPP"
    )
    first = await service.list_destinations(
        project_id=PROJECT_ID, artifact_id=artifact_id, limit=1
    )
    second = await service.list_destinations(
        project_id=PROJECT_ID, artifact_id=artifact_id, limit=1, cursor=first.cursor
    )

    assert [d.name for d in filtered.destinations] == ["support"]
    assert [d.name for d in first.destinations] == ["releases"]
    assert [d.name for d in second.destinations] == ["support"]
    assert second.cursor is None


async def test_second_call_within_ttl_does_not_call_slack():
    service, _, artifact_id, transport = _slack_setup()

    await service.list_destinations(project_id=PROJECT_ID, artifact_id=artifact_id)
    calls = len(transport.requests)
    await service.list_destinations(project_id=PROJECT_ID, artifact_id=artifact_id)

    assert len(transport.requests) == calls


async def test_no_connected_bot_lists_nothing():
    service, _, _, _ = _slack_setup()

    page = await service.list_destinations(project_id=PROJECT_ID, artifact_id=uuid4())

    assert page.destinations == []


def _telegram_setup(channel="telegram", **kwargs):
    artifact_id = uuid4()
    dao = FakeToolsDAO()
    connection = dao.seed_connection(channel=channel, data={"bot_token": "1:x"})
    dao.seed_agent(
        connection_id=connection.id,
        references={"application": {"id": str(artifact_id)}},
    )
    group = dao.seed_space(
        connection_id=connection.id,
        locator={"chat_id": -100, "title": "Ops group"},
        kind=ChannelSpaceKind.GROUP,
    )
    other_group = dao.seed_space(
        connection_id=connection.id,
        locator={"chat_id": -200, "title": "Old group"},
        kind=ChannelSpaceKind.GROUP,
    )
    dao.seed_space(
        connection_id=connection.id,
        locator={"chat_id": 55},
        kind=ChannelSpaceKind.PRIVATE,
    )
    adapter = (
        HostedTelegramAdapter() if channel == "telegram_hosted" else TelegramAdapter()
    )
    service = build_tools_service(dao, adapters={channel: adapter}, **kwargs)
    return service, artifact_id, group, other_group


async def test_telegram_lists_stored_groups_but_never_private_chats():
    service, artifact_id, group, other_group = _telegram_setup()

    page = await service.list_destinations(
        project_id=PROJECT_ID, artifact_id=artifact_id
    )

    assert sorted(d.name for d in page.destinations) == ["Old group", "Ops group"]
    assert all(
        d.platform == "telegram" and not d.supports_threads for d in page.destinations
    )


async def test_telegram_result_carries_the_limits_note():
    service, artifact_id, _, _ = _telegram_setup()

    page = await service.list_destinations(
        project_id=PROJECT_ID, artifact_id=artifact_id
    )

    assert any("Telegram" in note and "cannot list" in note for note in page.notes)


async def test_hosted_telegram_lists_only_chats_bound_to_this_project():
    bindings = SimpleNamespace(
        list_connection_bindings=AsyncMock(
            return_value=[SimpleNamespace(chat_id="-100")]
        )
    )
    service, artifact_id, group, _ = _telegram_setup(
        channel="telegram_hosted", telegram_binding_service=bindings
    )

    page = await service.list_destinations(
        project_id=PROJECT_ID, artifact_id=artifact_id
    )

    assert [decode_destination_id(d.destination_id) for d in page.destinations] == [
        group.id
    ]
