"""Adding a space puts the bot in it first, and writes nothing when it
cannot."""

from unittest.mock import AsyncMock, MagicMock
from uuid import uuid4

import pytest

from oss.src.core.channels.adapters.registry import ChannelAdapterRegistry
from oss.src.core.channels.dtos import (
    ChannelConnection,
    ChannelSpace,
    ChannelSpaceCreate,
    ChannelSpaceData,
    ChannelSpaceKind,
)
from oss.src.core.channels.service import ChannelsService
from oss.src.core.channels.types import ChannelSpaceJoinFailed
from oss.tests.pytest.unit.channels.slack.fake_slack import (
    make_adapter_and_workspace,
)

pytestmark = pytest.mark.asyncio


def _connection() -> ChannelConnection:
    return ChannelConnection(
        id=uuid4(),
        slug="slack-connection",
        channel="slack",
        external_key=uuid4(),
        data={
            "bot_token": "xoxb-fake",
            "bot_user_id": "UBOT1",
            "bot_username": "support-bot",
            "team_id": "T1",
        },
    )


def _service(*, adapter, dao) -> ChannelsService:
    return ChannelsService(
        channels_dao=dao,
        adapter_registry=ChannelAdapterRegistry(adapters={"slack": adapter}),
    )


def _dao(connection: ChannelConnection) -> MagicMock:
    dao = MagicMock()
    dao.fetch_connection = AsyncMock(return_value=connection)
    dao.create_space = AsyncMock(
        side_effect=lambda **kw: ChannelSpace(id=uuid4(), **kw["space"].model_dump())
    )
    return dao


def _space(connection: ChannelConnection, channel: str) -> ChannelSpaceCreate:
    return ChannelSpaceCreate(
        connection_id=connection.id,
        kind=ChannelSpaceKind.TOPIC,
        external_key=uuid4(),
        data=ChannelSpaceData(external_locator={"team": "T1", "channel": channel}),
    )


# --- create_space ----------------------------------------------------------- #


async def test_adding_a_public_channel_joins_it_then_writes_the_space():
    adapter, workspace, _transport = make_adapter_and_workspace(
        channels=[{"id": "C2", "name": "public", "is_member": False}]
    )
    connection = _connection()
    dao = _dao(connection)

    await _service(adapter=adapter, dao=dao).create_space(
        project_id=uuid4(), user_id=uuid4(), space=_space(connection, "C2")
    )

    assert workspace.channels["C2"]["is_member"] is True
    dao.create_space.assert_awaited_once()


async def test_a_channel_the_bot_cannot_join_writes_nothing():
    adapter, _workspace, _transport = make_adapter_and_workspace(
        channels=[{"id": "C4", "name": "s", "is_private": True, "is_member": False}]
    )
    connection = _connection()
    dao = _dao(connection)

    with pytest.raises(ChannelSpaceJoinFailed) as raised:
        await _service(adapter=adapter, dao=dao).create_space(
            project_id=uuid4(), user_id=uuid4(), space=_space(connection, "C4")
        )

    assert "/invite @support-bot" in str(raised.value)
    dao.create_space.assert_not_awaited()
