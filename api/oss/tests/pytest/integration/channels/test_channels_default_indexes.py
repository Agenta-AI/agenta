"""The two partial-unique-index rejections must be database-enforced, not
merely caught by application code — assert the IntegrityError/constraint
name directly against the DBE, bypassing the service's clear-then-set."""

import uuid

import pytest
from sqlalchemy import text
from sqlalchemy.exc import IntegrityError

from oss.src.core.channels.dtos import (
    ChannelAgentCreate,
    ChannelAgentData,
    ChannelAgentFlags,
    ChannelConnectionCreate,
    ChannelGrantCreate,
    ChannelGrantData,
    ChannelGrantEffect,
    ChannelGrantFlags,
    ChannelSpaceCreate,
    ChannelSpaceData,
    ChannelSpaceKind,
)
from oss.src.dbs.postgres.channels.dao import ChannelsDAO


pytestmark = pytest.mark.integration


async def test_second_default_agent_in_one_connection_is_rejected_by_the_database(
    channels_scope,
):
    dao = ChannelsDAO(engine=channels_scope["engine"])
    project_id = channels_scope["project_id"]
    connection_id = channels_scope["connection_id"]
    user_id = channels_scope["user_id"]

    await dao.create_agent(
        project_id=project_id,
        user_id=user_id,
        agent=ChannelAgentCreate(
            connection_id=connection_id,
            slug="first",
            data=ChannelAgentData(references={}),
            flags=ChannelAgentFlags(is_default=True),
        ),
    )

    with pytest.raises(IntegrityError) as caught:
        await dao.create_agent(
            project_id=project_id,
            user_id=user_id,
            agent=ChannelAgentCreate(
                connection_id=connection_id,
                slug="second",
                data=ChannelAgentData(references={}),
                flags=ChannelAgentFlags(is_default=True),
            ),
        )

    orig = getattr(caught.value, "orig", None)
    constraint = getattr(getattr(orig, "__cause__", None), "constraint_name", None)
    assert constraint == "uq_channel_agents_default" or (
        "uq_channel_agents_default" in str(orig or caught.value)
    )


async def test_second_default_grant_in_one_space_is_rejected_by_the_database(
    channels_scope,
):
    dao = ChannelsDAO(engine=channels_scope["engine"])
    project_id = channels_scope["project_id"]
    connection_id = channels_scope["connection_id"]
    user_id = channels_scope["user_id"]

    agent_one = await dao.create_agent(
        project_id=project_id,
        user_id=user_id,
        agent=ChannelAgentCreate(
            connection_id=connection_id,
            slug="agent-one",
            data=ChannelAgentData(references={}),
        ),
    )
    agent_two = await dao.create_agent(
        project_id=project_id,
        user_id=user_id,
        agent=ChannelAgentCreate(
            connection_id=connection_id,
            slug="agent-two",
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

    await dao.create_grant(
        project_id=project_id,
        user_id=user_id,
        grant=ChannelGrantCreate(
            agent_id=agent_one.id,
            effect=ChannelGrantEffect.ALLOW,
            space_id=space.id,
            data=ChannelGrantData(),
            flags=ChannelGrantFlags(is_default=True),
        ),
    )

    with pytest.raises(IntegrityError) as caught:
        await dao.create_grant(
            project_id=project_id,
            user_id=user_id,
            grant=ChannelGrantCreate(
                agent_id=agent_two.id,
                effect=ChannelGrantEffect.ALLOW,
                space_id=space.id,
                data=ChannelGrantData(),
                flags=ChannelGrantFlags(is_default=True),
            ),
        )

    orig = getattr(caught.value, "orig", None)
    constraint = getattr(getattr(orig, "__cause__", None), "constraint_name", None)
    assert constraint == "uq_channel_grants_default" or (
        "uq_channel_grants_default" in str(orig or caught.value)
    )


async def test_duplicate_space_scoped_grant_is_rejected_by_the_database(
    channels_scope,
):
    """`uq_channel_grants_by_space`: NULLs are distinct in Postgres, so this
    must be a real assertion, not an assumption -- the same (agent, space,
    effect) twice is rejected."""

    dao = ChannelsDAO(engine=channels_scope["engine"])
    project_id = channels_scope["project_id"]
    connection_id = channels_scope["connection_id"]
    user_id = channels_scope["user_id"]

    agent = await dao.create_agent(
        project_id=project_id,
        user_id=user_id,
        agent=ChannelAgentCreate(
            connection_id=connection_id,
            slug="triage",
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

    await dao.create_grant(
        project_id=project_id,
        user_id=user_id,
        grant=ChannelGrantCreate(
            agent_id=agent.id,
            effect=ChannelGrantEffect.ALLOW,
            space_id=space.id,
            data=ChannelGrantData(),
        ),
    )

    with pytest.raises(IntegrityError) as caught:
        await dao.create_grant(
            project_id=project_id,
            user_id=user_id,
            grant=ChannelGrantCreate(
                agent_id=agent.id,
                effect=ChannelGrantEffect.ALLOW,
                space_id=space.id,
                data=ChannelGrantData(),
            ),
        )

    orig = getattr(caught.value, "orig", None)
    constraint = getattr(getattr(orig, "__cause__", None), "constraint_name", None)
    assert constraint == "uq_channel_grants_by_space" or (
        "uq_channel_grants_by_space" in str(orig or caught.value)
    )


async def test_duplicate_kind_scoped_grant_is_rejected_by_the_database(
    channels_scope,
):
    """`uq_channel_grants_by_kind`: the same (agent, kind, effect) twice is
    rejected -- the branch a single not-null space_id constraint never had
    to cover."""

    dao = ChannelsDAO(engine=channels_scope["engine"])
    project_id = channels_scope["project_id"]
    connection_id = channels_scope["connection_id"]
    user_id = channels_scope["user_id"]

    agent = await dao.create_agent(
        project_id=project_id,
        user_id=user_id,
        agent=ChannelAgentCreate(
            connection_id=connection_id,
            slug="triage",
            data=ChannelAgentData(references={}),
        ),
    )

    await dao.create_grant(
        project_id=project_id,
        user_id=user_id,
        grant=ChannelGrantCreate(
            agent_id=agent.id,
            effect=ChannelGrantEffect.ALLOW,
            kind=ChannelSpaceKind.PRIVATE,
            data=ChannelGrantData(),
        ),
    )

    with pytest.raises(IntegrityError) as caught:
        await dao.create_grant(
            project_id=project_id,
            user_id=user_id,
            grant=ChannelGrantCreate(
                agent_id=agent.id,
                effect=ChannelGrantEffect.ALLOW,
                kind=ChannelSpaceKind.PRIVATE,
                data=ChannelGrantData(),
            ),
        )

    orig = getattr(caught.value, "orig", None)
    constraint = getattr(getattr(orig, "__cause__", None), "constraint_name", None)
    assert constraint == "uq_channel_grants_by_kind" or (
        "uq_channel_grants_by_kind" in str(orig or caught.value)
    )


async def test_a_kind_scoped_deny_does_not_collide_with_a_space_scoped_allow(
    channels_scope,
):
    """The two branches are independent indexes: a kind-level DENY and a
    space-level ALLOW for the same agent coexist without violating either."""

    dao = ChannelsDAO(engine=channels_scope["engine"])
    project_id = channels_scope["project_id"]
    connection_id = channels_scope["connection_id"]
    user_id = channels_scope["user_id"]

    agent = await dao.create_agent(
        project_id=project_id,
        user_id=user_id,
        agent=ChannelAgentCreate(
            connection_id=connection_id,
            slug="triage",
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
            data=ChannelSpaceData(external_locator={"team": "T1", "channel": "C2"}),
        ),
    )

    await dao.create_grant(
        project_id=project_id,
        user_id=user_id,
        grant=ChannelGrantCreate(
            agent_id=agent.id,
            effect=ChannelGrantEffect.DENY,
            kind=ChannelSpaceKind.TOPIC,
            data=ChannelGrantData(),
        ),
    )
    await dao.create_grant(
        project_id=project_id,
        user_id=user_id,
        grant=ChannelGrantCreate(
            agent_id=agent.id,
            effect=ChannelGrantEffect.ALLOW,
            space_id=space.id,
            data=ChannelGrantData(),
        ),
    )

    rows = await dao.query_grants(project_id=project_id)
    assert len(rows) == 2


async def test_two_projects_cannot_register_the_same_channel_and_external_key(
    channels_scope,
):
    """`uq_channel_connections_external_key` is deliberately NOT
    project-scoped: the ingress resolves the project FROM this key, so two
    tenants cannot legitimately share one installation."""

    dao = ChannelsDAO(engine=channels_scope["engine"])
    project_id = channels_scope["project_id"]
    user_id = channels_scope["user_id"]
    external_key = uuid.uuid4()

    await dao.create_connection(
        project_id=project_id,
        user_id=user_id,
        connection=ChannelConnectionCreate(
            channel="slack",
            external_key=external_key,
            slug="workspace-a",
        ),
    )

    other_project_id = uuid.uuid4()
    async with dao.engine.session() as session:
        await session.execute(
            text(
                "INSERT INTO projects "
                "(id, project_name, workspace_id, organization_id) "
                "SELECT :id, 'second-project', workspace_id, organization_id "
                "FROM projects WHERE id = :existing"
            ),
            {"id": other_project_id, "existing": project_id},
        )
        await session.commit()

    try:
        with pytest.raises(IntegrityError) as caught:
            await dao.create_connection(
                project_id=other_project_id,
                user_id=user_id,
                connection=ChannelConnectionCreate(
                    channel="slack",
                    external_key=external_key,
                    slug="workspace-a-again",
                ),
            )

        orig = getattr(caught.value, "orig", None)
        constraint = getattr(getattr(orig, "__cause__", None), "constraint_name", None)
        assert constraint == "uq_channel_connections_external_key" or (
            "uq_channel_connections_external_key" in str(orig or caught.value)
        )
    finally:
        async with dao.engine.session() as session:
            await session.execute(
                text("DELETE FROM channel_connections WHERE project_id = :id"),
                {"id": other_project_id},
            )
            await session.execute(
                text("DELETE FROM projects WHERE id = :id"), {"id": other_project_id}
            )
            await session.commit()
