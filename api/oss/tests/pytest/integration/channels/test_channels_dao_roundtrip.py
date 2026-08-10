"""create_* -> fetch_* round-trips: the returned DTO equals what was passed
in, field for field, modulo server-assigned fields (id, timestamps)."""

import uuid

import pytest

from oss.src.core.channels.dtos import (
    ChannelAgentCreate,
    ChannelAgentData,
    ChannelConnectionCreate,
    ChannelConnectionEdit,
    ChannelGrantCreate,
    ChannelGrantData,
    ChannelGrantEffect,
    ChannelSpaceCreate,
    ChannelSpaceData,
    ChannelSpaceKind,
    ChannelThreadCreate,
    ChannelThreadData,
)
from oss.src.dbs.postgres.channels.dao import ChannelsDAO


pytestmark = pytest.mark.integration


async def test_connection_roundtrip(channels_scope):
    dao = ChannelsDAO(engine=channels_scope["engine"])
    project_id = channels_scope["project_id"]
    user_id = channels_scope["user_id"]
    external_key = uuid.uuid4()

    created = await dao.create_connection(
        project_id=project_id,
        user_id=user_id,
        connection=ChannelConnectionCreate(
            channel="slack",
            external_key=external_key,
            slug="acme-workspace",
            name="Acme",
            data={"connection_locator": {"team": "T1"}},
        ),
    )

    fetched = await dao.fetch_connection(
        project_id=project_id, connection_id=created.id
    )

    assert fetched is not None
    assert fetched.channel == "slack"
    assert fetched.external_key == external_key
    assert fetched.slug == "acme-workspace"
    assert fetched.data == created.data

    edited = await dao.edit_connection(
        project_id=project_id,
        user_id=user_id,
        connection=ChannelConnectionEdit(
            id=created.id,
            name="Acme Corp",
            data={"connection_locator": {"team": "T1"}, "verified": True},
        ),
    )
    assert edited.name == "Acme Corp"
    # channel and external_key are immutable through edit -- unaffected
    assert edited.channel == "slack"
    assert edited.external_key == external_key

    rows = await dao.query_connections(project_id=project_id)
    assert len(rows) == 1
    assert rows[0].id == created.id

    deleted = await dao.delete_connection(
        project_id=project_id, connection_id=created.id
    )
    assert deleted is True
    assert (
        await dao.fetch_connection(project_id=project_id, connection_id=created.id)
        is None
    )


async def test_agent_roundtrip(channels_scope):
    dao = ChannelsDAO(engine=channels_scope["engine"])
    project_id = channels_scope["project_id"]
    connection_id = channels_scope["connection_id"]

    created = await dao.create_agent(
        project_id=project_id,
        user_id=channels_scope["user_id"],
        agent=ChannelAgentCreate(
            connection_id=connection_id,
            slug="support",
            name="Support",
            data=ChannelAgentData(references={}),
        ),
    )

    fetched = await dao.fetch_agent(project_id=project_id, agent_id=created.id)

    assert fetched is not None
    assert fetched.slug == "support"
    assert fetched.name == "Support"
    assert fetched.connection_id == connection_id
    assert fetched.data == created.data
    assert fetched.flags == created.flags

    by_slug = await dao.fetch_agent_by_slug(
        project_id=project_id, connection_id=connection_id, slug="support"
    )
    assert by_slug.id == created.id


async def test_space_roundtrip(channels_scope):
    dao = ChannelsDAO(engine=channels_scope["engine"])
    project_id = channels_scope["project_id"]
    connection_id = channels_scope["connection_id"]
    external_key = uuid.uuid4()
    locator = {"team": "T1", "channel": "C1"}

    created = await dao.create_space(
        project_id=project_id,
        user_id=channels_scope["user_id"],
        space=ChannelSpaceCreate(
            connection_id=connection_id,
            kind=ChannelSpaceKind.TOPIC,
            external_key=external_key,
            data=ChannelSpaceData(external_locator=locator),
        ),
    )

    fetched = await dao.fetch_space(project_id=project_id, space_id=created.id)

    assert fetched is not None
    assert fetched.kind == ChannelSpaceKind.TOPIC
    assert fetched.external_key == external_key
    assert fetched.data.external_locator == locator

    by_key = await dao.fetch_space_by_key(
        project_id=project_id, connection_id=connection_id, external_key=external_key
    )
    assert by_key.id == created.id


async def test_grant_roundtrip(channels_scope):
    dao = ChannelsDAO(engine=channels_scope["engine"])
    project_id = channels_scope["project_id"]
    connection_id = channels_scope["connection_id"]
    user_id = channels_scope["user_id"]

    agent = await dao.create_agent(
        project_id=project_id,
        user_id=user_id,
        agent=ChannelAgentCreate(
            connection_id=connection_id,
            slug="agent",
            data=ChannelAgentData(references={}),
        ),
    )
    space = await dao.create_space(
        project_id=project_id,
        user_id=user_id,
        space=ChannelSpaceCreate(
            connection_id=connection_id,
            kind=ChannelSpaceKind.TOPIC,
            external_key=uuid.uuid4(),
            data=ChannelSpaceData(external_locator={"team": "T1", "channel": "C1"}),
        ),
    )

    created = await dao.create_grant(
        project_id=project_id,
        user_id=user_id,
        grant=ChannelGrantCreate(
            agent_id=agent.id,
            effect=ChannelGrantEffect.ALLOW,
            space_id=space.id,
            data=ChannelGrantData(),
        ),
    )

    fetched = await dao.fetch_grant(
        project_id=project_id, agent_id=agent.id, space_id=space.id
    )

    assert fetched is not None
    assert fetched.id == created.id
    assert fetched.agent_id == agent.id
    assert fetched.space_id == space.id

    count = await dao.count_grants(project_id=project_id, agent_id=agent.id)
    assert count == 1


async def test_thread_roundtrip(channels_scope):
    dao = ChannelsDAO(engine=channels_scope["engine"])
    project_id = channels_scope["project_id"]
    connection_id = channels_scope["connection_id"]
    user_id = channels_scope["user_id"]

    agent = await dao.create_agent(
        project_id=project_id,
        user_id=user_id,
        agent=ChannelAgentCreate(
            connection_id=connection_id,
            slug="agent",
            data=ChannelAgentData(references={}),
        ),
    )
    space = await dao.create_space(
        project_id=project_id,
        user_id=user_id,
        space=ChannelSpaceCreate(
            connection_id=connection_id,
            kind=ChannelSpaceKind.TOPIC,
            external_key=uuid.uuid4(),
            data=ChannelSpaceData(external_locator={"team": "T1", "channel": "C1"}),
        ),
    )
    external_key = uuid.uuid4()

    created = await dao.create_thread(
        project_id=project_id,
        user_id=user_id,
        thread=ChannelThreadCreate(
            space_id=space.id,
            agent_id=agent.id,
            external_key=external_key,
            session_id="session-1",
            data=ChannelThreadData(),
        ),
    )

    fetched = await dao.fetch_current_thread(
        project_id=project_id,
        space_id=space.id,
        external_key=external_key,
        agent_id=agent.id,
    )

    assert fetched is not None
    assert fetched.id == created.id
    assert fetched.session_id == "session-1"


async def test_fetch_current_thread_returns_the_latest_row_not_a_unique_lookup(
    channels_scope,
):
    dao = ChannelsDAO(engine=channels_scope["engine"])
    project_id = channels_scope["project_id"]
    connection_id = channels_scope["connection_id"]
    user_id = channels_scope["user_id"]

    agent = await dao.create_agent(
        project_id=project_id,
        user_id=user_id,
        agent=ChannelAgentCreate(
            connection_id=connection_id,
            slug="agent",
            data=ChannelAgentData(references={}),
        ),
    )
    space = await dao.create_space(
        project_id=project_id,
        user_id=user_id,
        space=ChannelSpaceCreate(
            connection_id=connection_id,
            kind=ChannelSpaceKind.TOPIC,
            external_key=uuid.uuid4(),
            data=ChannelSpaceData(external_locator={"team": "T1", "channel": "C1"}),
        ),
    )
    external_key = uuid.uuid4()

    await dao.create_thread(
        project_id=project_id,
        user_id=user_id,
        thread=ChannelThreadCreate(
            space_id=space.id,
            agent_id=agent.id,
            external_key=external_key,
            session_id="session-old",
            data=ChannelThreadData(),
        ),
    )
    newest = await dao.create_thread(
        project_id=project_id,
        user_id=user_id,
        thread=ChannelThreadCreate(
            space_id=space.id,
            agent_id=agent.id,
            external_key=external_key,
            session_id="session-new",
            data=ChannelThreadData(),
        ),
    )

    fetched = await dao.fetch_current_thread(
        project_id=project_id,
        space_id=space.id,
        external_key=external_key,
        agent_id=agent.id,
    )

    assert fetched.id == newest.id
    assert fetched.session_id == "session-new"


async def test_mark_space_backfilled_is_idempotent(channels_scope):
    dao = ChannelsDAO(engine=channels_scope["engine"])
    project_id = channels_scope["project_id"]
    connection_id = channels_scope["connection_id"]
    user_id = channels_scope["user_id"]

    space = await dao.create_space(
        project_id=project_id,
        user_id=user_id,
        space=ChannelSpaceCreate(
            connection_id=connection_id,
            kind=ChannelSpaceKind.TOPIC,
            external_key=uuid.uuid4(),
            data=ChannelSpaceData(external_locator={"team": "T1", "channel": "C1"}),
        ),
    )
    assert space.flags.is_backfilled is False

    first = await dao.mark_space_backfilled(project_id=project_id, space_id=space.id)
    second = await dao.mark_space_backfilled(project_id=project_id, space_id=space.id)

    assert first.flags.is_backfilled is True
    assert second.flags.is_backfilled is True
    assert first.id == second.id == space.id

    rows = await dao.query_spaces(project_id=project_id)
    assert len(rows) == 1


async def test_close_thread_flips_is_active_in_place(channels_scope):
    dao = ChannelsDAO(engine=channels_scope["engine"])
    project_id = channels_scope["project_id"]
    connection_id = channels_scope["connection_id"]
    user_id = channels_scope["user_id"]

    agent = await dao.create_agent(
        project_id=project_id,
        user_id=user_id,
        agent=ChannelAgentCreate(
            connection_id=connection_id,
            slug="agent",
            data=ChannelAgentData(references={}),
        ),
    )
    space = await dao.create_space(
        project_id=project_id,
        user_id=user_id,
        space=ChannelSpaceCreate(
            connection_id=connection_id,
            kind=ChannelSpaceKind.TOPIC,
            external_key=uuid.uuid4(),
            data=ChannelSpaceData(external_locator={"team": "T1", "channel": "C1"}),
        ),
    )
    thread = await dao.create_thread(
        project_id=project_id,
        user_id=user_id,
        thread=ChannelThreadCreate(
            space_id=space.id,
            agent_id=agent.id,
            session_id="session-1",
            data=ChannelThreadData(),
        ),
    )
    assert thread.flags.is_active is True

    closed = await dao.close_thread(
        project_id=project_id, user_id=user_id, thread_id=thread.id
    )

    assert closed.id == thread.id
    assert closed.flags.is_active is False

    rows = await dao.query_threads(project_id=project_id)
    assert len(rows) == 1
