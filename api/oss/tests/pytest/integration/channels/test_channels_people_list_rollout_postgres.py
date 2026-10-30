"""Rollout: a people-list change on a binding is also written to the
installation's `allowed_senders`, in the same transaction, because API pods of
the previous release read the list there."""

import json
import uuid

import pytest
from sqlalchemy import text

from oss.src.core.channels.adapters.registry import ChannelAdapterRegistry
from oss.src.core.channels.dtos import (
    ChannelAgentCreate,
    ChannelAgentData,
    ChannelAgentDataEdit,
    ChannelAgentEdit,
    ChannelAgentFlags,
)
from oss.src.core.channels.service import ChannelsService
from oss.src.dbs.postgres.channels.dao import ChannelsDAO

from oss.tests.pytest.unit.channels.contract.fakes import WellBehavedFakeAdapter

pytestmark = pytest.mark.integration


async def _installation_list(channels_scope):
    async with channels_scope["engine"].session() as session:
        data = (
            await session.execute(
                text(
                    "SELECT data FROM channel_connections "
                    "WHERE project_id = :project_id AND id = :id"
                ),
                {
                    "project_id": channels_scope["project_id"],
                    "id": channels_scope["connection_id"],
                },
            )
        ).scalar_one()
    data = json.loads(data) if isinstance(data, str) else (data or {})
    return data.get("allowed_senders")


async def test_the_installation_list_follows_the_binding_list(channels_scope):
    dao = ChannelsDAO(engine=channels_scope["engine"])
    service = ChannelsService(
        channels_dao=dao,
        adapter_registry=ChannelAdapterRegistry(
            adapters={"slack": WellBehavedFakeAdapter()}
        ),
    )
    project_id = channels_scope["project_id"]
    references = {"workflow_revision": {"id": str(uuid.uuid4())}}

    created = await service.create_agent(
        project_id=project_id,
        user_id=channels_scope["user_id"],
        guard_user_id=None,
        agent=ChannelAgentCreate(
            connection_id=channels_scope["connection_id"],
            slug="rollout",
            data=ChannelAgentData.model_validate(
                {"references": references, "audience": {"senders": ["UANA"]}}
            ),
            flags=ChannelAgentFlags(is_active=False),
        ),
    )
    assert await _installation_list(channels_scope) == ["UANA"]

    await service.edit_agent(
        project_id=project_id,
        user_id=channels_scope["user_id"],
        guard_user_id=None,
        agent=ChannelAgentEdit(
            id=created.id,
            data=ChannelAgentDataEdit(audience={"senders": ["UBEN", "UCAL"]}),
        ),
    )
    assert await _installation_list(channels_scope) == ["UBEN", "UCAL"]

    # an edit that leaves the list alone does not touch the installation
    await service.edit_agent(
        project_id=project_id,
        user_id=channels_scope["user_id"],
        guard_user_id=None,
        agent=ChannelAgentEdit(id=created.id, name="renamed"),
    )
    assert await _installation_list(channels_scope) == ["UBEN", "UCAL"]

    await service.edit_agent(
        project_id=project_id,
        user_id=channels_scope["user_id"],
        guard_user_id=None,
        agent=ChannelAgentEdit(
            id=created.id, data=ChannelAgentDataEdit(audience={"senders": []})
        ),
    )
    assert await _installation_list(channels_scope) == []
