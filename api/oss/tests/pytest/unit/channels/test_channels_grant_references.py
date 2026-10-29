"""A grant names an agent and, optionally, a space, and nothing in the schema
ties either id to a row. The service checks both belong to the caller's
project, so a grant can never point at another project's agent or space.
"""

from unittest.mock import AsyncMock, MagicMock
from uuid import uuid4

import pytest

from oss.src.core.channels.adapters.registry import ChannelAdapterRegistry
from oss.src.core.channels.dtos import (
    ChannelGrantCreate,
    ChannelGrantData,
    ChannelGrantEffect,
)
from oss.src.core.channels.service import ChannelsService
from oss.src.core.channels.types import ChannelAgentNotFound, ChannelSpaceNotFound

pytestmark = pytest.mark.asyncio


def _service(*, agent, space):
    dao = MagicMock()
    dao.fetch_agent = AsyncMock(return_value=agent)
    dao.fetch_space = AsyncMock(return_value=space)
    dao.create_grant = AsyncMock(side_effect=lambda **kw: kw["grant"])
    service = ChannelsService(
        channels_dao=dao, adapter_registry=ChannelAdapterRegistry(adapters={})
    )
    return service, dao


def _grant(*, space_id=None):
    return ChannelGrantCreate(
        agent_id=uuid4(),
        effect=ChannelGrantEffect.ALLOW,
        space_id=space_id,
        kind=None if space_id else "private",
        data=ChannelGrantData(),
    )


async def test_a_grant_on_an_agent_outside_the_project_is_refused():
    service, dao = _service(agent=None, space=object())
    project_id = uuid4()
    grant = _grant(space_id=uuid4())

    with pytest.raises(ChannelAgentNotFound):
        await service.create_grant(project_id=project_id, user_id=uuid4(), grant=grant)

    dao.fetch_agent.assert_awaited_once_with(
        project_id=project_id, agent_id=grant.agent_id
    )
    dao.create_grant.assert_not_awaited()


async def test_a_grant_on_a_space_outside_the_project_is_refused():
    service, dao = _service(agent=object(), space=None)
    project_id = uuid4()
    grant = _grant(space_id=uuid4())

    with pytest.raises(ChannelSpaceNotFound):
        await service.create_grant(project_id=project_id, user_id=uuid4(), grant=grant)

    dao.fetch_space.assert_awaited_once_with(
        project_id=project_id, space_id=grant.space_id
    )
    dao.create_grant.assert_not_awaited()


async def test_a_grant_on_the_projects_own_agent_and_space_is_written():
    service, dao = _service(agent=object(), space=object())
    grant = _grant(space_id=uuid4())

    written = await service.create_grant(
        project_id=uuid4(), user_id=uuid4(), grant=grant
    )

    assert written is grant
    dao.create_grant.assert_awaited_once()


async def test_a_kind_grant_needs_no_space():
    service, dao = _service(agent=object(), space=None)

    await service.create_grant(project_id=uuid4(), user_id=uuid4(), grant=_grant())

    dao.fetch_space.assert_not_awaited()
    dao.create_grant.assert_awaited_once()
