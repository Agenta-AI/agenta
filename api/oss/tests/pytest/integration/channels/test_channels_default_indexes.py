"""The two partial-unique-index rejections must be database-enforced, not
merely caught by application code — assert the IntegrityError/constraint
name directly against the DBE, bypassing the service's clear-then-set."""

import uuid

import pytest
from sqlalchemy.exc import IntegrityError

from oss.src.core.channels.dtos import (
    ChannelAgentCreate,
    ChannelAgentData,
    ChannelAgentFlags,
    ChannelGrantCreate,
    ChannelGrantData,
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
