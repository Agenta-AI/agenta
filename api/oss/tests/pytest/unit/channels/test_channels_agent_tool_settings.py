"""The channel tool settings live on the bot binding, in `data.tools`.

A bot stored before the block existed reads as the permissive defaults, and
an edit that sends only `tools` keeps the stored references and policy.
"""

from unittest.mock import AsyncMock, MagicMock
from uuid import uuid4

import pytest

from oss.src.core.channels.adapters.registry import ChannelAdapterRegistry
from oss.src.core.channels.dtos import (
    ChannelAgent,
    ChannelAgentData,
    ChannelAgentDataEdit,
    ChannelAgentEdit,
    ChannelAgentToolSettings,
    ChannelPolicy,
)
from oss.src.core.channels.service import ChannelsService

pytestmark = pytest.mark.asyncio

APP_ID = "11111111-1111-4111-8111-111111111111"


def _stored_agent(**data) -> ChannelAgent:
    return ChannelAgent(
        id=uuid4(),
        slug="default",
        connection_id=uuid4(),
        data=ChannelAgentData.model_validate(
            {"references": {"application": {"id": APP_ID}}, **data}
        ),
    )


def _service(existing: ChannelAgent):
    dao = MagicMock()
    dao.fetch_agent = AsyncMock(return_value=existing)
    dao.edit_agent = AsyncMock(side_effect=lambda **kw: kw["agent"])
    service = ChannelsService(
        channels_dao=dao, adapter_registry=ChannelAdapterRegistry(adapters={})
    )
    return service, dao


async def test_agent_data_without_tools_reads_defaults():
    data = ChannelAgentData.model_validate(
        {"references": {"application": {"id": APP_ID}}}
    )

    assert data.tools.can_post_outside_conversation is True
    assert data.tools.readable_space_keys is None


async def test_edit_tools_keeps_references_and_policy():
    existing = _stored_agent(policy={"backfill": True})
    service, dao = _service(existing)

    await service.edit_agent(
        project_id=uuid4(),
        user_id=uuid4(),
        agent=ChannelAgentEdit(
            id=existing.id,
            data=ChannelAgentDataEdit(
                tools=ChannelAgentToolSettings(
                    can_post_outside_conversation=False, readable_space_keys=[]
                )
            ),
        ),
    )

    written = dao.edit_agent.call_args.kwargs["agent"]
    assert written.data.references == existing.data.references
    assert written.data.policy == ChannelPolicy(backfill=True)
    assert written.data.tools.can_post_outside_conversation is False
    assert written.data.tools.readable_space_keys == []


async def test_edit_without_tools_keeps_stored_tools():
    key = uuid4()
    existing = _stored_agent(
        tools={"can_post_outside_conversation": False, "readable_space_keys": [key]}
    )
    service, dao = _service(existing)

    await service.edit_agent(
        project_id=uuid4(),
        user_id=uuid4(),
        agent=ChannelAgentEdit(
            id=existing.id,
            data=ChannelAgentDataEdit(policy=ChannelPolicy(backfill=False)),
        ),
    )

    written = dao.edit_agent.call_args.kwargs["agent"]
    assert written.data.tools.can_post_outside_conversation is False
    assert written.data.tools.readable_space_keys == [key]
