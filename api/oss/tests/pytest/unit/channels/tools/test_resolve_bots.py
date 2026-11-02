"""Which bots a run speaks for: the server matches the run's workflow artifact
against the project's bot bindings. Nothing the model sends takes part."""

from types import SimpleNamespace
from unittest.mock import AsyncMock
from uuid import uuid4

import pytest

from oss.src.core.channels.tools.types import ChannelToolsRefused

from .fakes import PROJECT_ID, FakeToolsDAO, build_tools_service

pytestmark = pytest.mark.asyncio


def _app_ref(artifact_id):
    return {"application": {"id": str(artifact_id)}}


async def test_matches_application_reference():
    artifact_id = uuid4()
    dao = FakeToolsDAO()
    connection = dao.seed_connection()
    agent = dao.seed_agent(
        connection_id=connection.id, references=_app_ref(artifact_id)
    )
    service = build_tools_service(dao, adapters={})

    bots = await service.resolve_bots(project_id=PROJECT_ID, artifact_id=artifact_id)

    assert [(b.agent.id, b.connection.id) for b in bots] == [(agent.id, connection.id)]


async def test_matches_workflow_reference():
    artifact_id = uuid4()
    dao = FakeToolsDAO()
    connection = dao.seed_connection()
    dao.seed_agent(
        connection_id=connection.id, references={"workflow": {"id": str(artifact_id)}}
    )
    service = build_tools_service(dao, adapters={})

    bots = await service.resolve_bots(project_id=PROJECT_ID, artifact_id=artifact_id)

    assert len(bots) == 1


async def test_matches_variant_and_revision_references_through_their_artifact():
    artifact_id = uuid4()
    variant_id, revision_id = uuid4(), uuid4()
    dao = FakeToolsDAO()
    first = dao.seed_connection()
    second = dao.seed_connection(channel="telegram", data={"bot_token": "1:x"})
    dao.seed_agent(
        connection_id=first.id,
        references={"workflow_variant": {"id": str(variant_id)}},
    )
    dao.seed_agent(
        connection_id=second.id,
        references={"application_revision": {"id": str(revision_id)}},
    )
    workflows = SimpleNamespace(
        fetch_workflow_variant=AsyncMock(
            return_value=SimpleNamespace(workflow_id=artifact_id)
        ),
        fetch_workflow_revision=AsyncMock(
            return_value=SimpleNamespace(workflow_id=artifact_id)
        ),
    )
    service = build_tools_service(dao, adapters={}, workflows_service=workflows)

    bots = await service.resolve_bots(project_id=PROJECT_ID, artifact_id=artifact_id)

    assert {b.connection.id for b in bots} == {first.id, second.id}


@pytest.mark.parametrize(
    "flags",
    [{"is_active": False}, {"is_verified": False}],
)
async def test_skips_inactive_and_unverified_connections(flags):
    artifact_id = uuid4()
    dao = FakeToolsDAO()
    connection = dao.seed_connection(**flags)
    dao.seed_agent(connection_id=connection.id, references=_app_ref(artifact_id))
    service = build_tools_service(dao, adapters={})

    assert (
        await service.resolve_bots(project_id=PROJECT_ID, artifact_id=artifact_id) == []
    )


async def test_skips_archived_connections_and_inactive_bindings():
    artifact_id = uuid4()
    dao = FakeToolsDAO()
    archived = dao.seed_connection()
    dao.seed_agent(connection_id=archived.id, references=_app_ref(artifact_id))
    dao.archive_connection(archived.id)
    live = dao.seed_connection()
    dao.seed_agent(
        connection_id=live.id, references=_app_ref(artifact_id), is_active=False
    )
    service = build_tools_service(dao, adapters={})

    assert (
        await service.resolve_bots(project_id=PROJECT_ID, artifact_id=artifact_id) == []
    )


async def test_two_bots_on_one_connection_are_refused_as_ambiguous():
    artifact_id = uuid4()
    dao = FakeToolsDAO()
    connection = dao.seed_connection()
    dao.seed_agent(connection_id=connection.id, references=_app_ref(artifact_id))
    dao.seed_agent(connection_id=connection.id, references=_app_ref(artifact_id))
    service = build_tools_service(dao, adapters={})

    with pytest.raises(ChannelToolsRefused, match="more than once"):
        await service.resolve_bots(project_id=PROJECT_ID, artifact_id=artifact_id)


async def test_bots_on_two_connections_both_match():
    artifact_id = uuid4()
    dao = FakeToolsDAO()
    for _ in range(2):
        connection = dao.seed_connection()
        dao.seed_agent(connection_id=connection.id, references=_app_ref(artifact_id))
    service = build_tools_service(dao, adapters={})

    bots = await service.resolve_bots(project_id=PROJECT_ID, artifact_id=artifact_id)

    assert len(bots) == 2


async def test_no_match_returns_empty():
    dao = FakeToolsDAO()
    connection = dao.seed_connection()
    dao.seed_agent(connection_id=connection.id, references=_app_ref(uuid4()))
    service = build_tools_service(dao, adapters={})

    assert await service.resolve_bots(project_id=PROJECT_ID, artifact_id=uuid4()) == []


async def test_is_available_true_for_active_verified_bot():
    artifact_id = uuid4()
    dao = FakeToolsDAO()
    connection = dao.seed_connection()
    dao.seed_agent(connection_id=connection.id, references=_app_ref(artifact_id))
    service = build_tools_service(dao, adapters={})

    assert await service.is_available(project_id=PROJECT_ID, artifact_id=artifact_id)


async def test_is_available_false_after_disconnect_or_archive():
    artifact_id = uuid4()
    dao = FakeToolsDAO()
    switched_off = dao.seed_connection(is_active=False)
    dao.seed_agent(connection_id=switched_off.id, references=_app_ref(artifact_id))
    archived = dao.seed_connection()
    dao.seed_agent(connection_id=archived.id, references=_app_ref(artifact_id))
    dao.archive_connection(archived.id)
    service = build_tools_service(dao, adapters={})

    assert not await service.is_available(
        project_id=PROJECT_ID, artifact_id=artifact_id
    )


ALL_TOOLS = [
    "list_channel_destinations",
    "send_channel_message",
    "read_channel_messages",
    "search_channel_messages",
]


async def test_available_tools_are_all_four_by_default():
    artifact_id = uuid4()
    dao = FakeToolsDAO()
    connection = dao.seed_connection()
    dao.seed_agent(connection_id=connection.id, references=_app_ref(artifact_id))
    service = build_tools_service(dao, adapters={})

    tools = await service.available_tools(
        project_id=PROJECT_ID, artifact_id=artifact_id
    )

    assert tools == ALL_TOOLS


@pytest.mark.parametrize(
    "settings,expected",
    [
        ({"can_post_outside_conversation": False}, [ALL_TOOLS[0], *ALL_TOOLS[2:]]),
        ({"readable_space_keys": []}, ALL_TOOLS[:2]),
        (
            {"can_post_outside_conversation": False, "readable_space_keys": []},
            ALL_TOOLS[:1],
        ),
    ],
)
async def test_available_tools_follow_the_bot_settings(settings, expected):
    artifact_id = uuid4()
    dao = FakeToolsDAO()
    connection = dao.seed_connection()
    dao.seed_agent(
        connection_id=connection.id, references=_app_ref(artifact_id), tools=settings
    )
    service = build_tools_service(dao, adapters={})

    tools = await service.available_tools(
        project_id=PROJECT_ID, artifact_id=artifact_id
    )

    assert tools == expected


async def test_one_permissive_bot_is_enough_for_a_tool():
    artifact_id = uuid4()
    dao = FakeToolsDAO()
    closed = dao.seed_connection()
    dao.seed_agent(
        connection_id=closed.id,
        references=_app_ref(artifact_id),
        tools={"can_post_outside_conversation": False, "readable_space_keys": []},
    )
    open_ = dao.seed_connection()
    dao.seed_agent(connection_id=open_.id, references=_app_ref(artifact_id))
    service = build_tools_service(dao, adapters={})

    tools = await service.available_tools(
        project_id=PROJECT_ID, artifact_id=artifact_id
    )

    assert tools == ALL_TOOLS


async def test_no_bot_means_no_tools():
    dao = FakeToolsDAO()
    service = build_tools_service(dao, adapters={})

    assert (
        await service.available_tools(project_id=PROJECT_ID, artifact_id=uuid4()) == []
    )
