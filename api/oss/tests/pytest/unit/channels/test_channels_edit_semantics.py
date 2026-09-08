"""An edit names what changes; an omitted field keeps its stored value.

A plain rename once nulled a connection's whole data blob, credential
reference included, and bricked it for good (F98). A policy-only agent edit
reset the default flag and muted the connection (F91). Both edit paths now
layer the caller's fields over the stored row before the write.
"""

from unittest.mock import AsyncMock, MagicMock
from uuid import uuid4

import pytest

from oss.src.core.channels.adapters.registry import ChannelAdapterRegistry
from oss.src.core.channels.dtos import (
    ChannelAgent,
    ChannelAgentData,
    ChannelAgentEdit,
    ChannelAgentFlags,
    ChannelConnection,
    ChannelConnectionEdit,
    ChannelConnectionFlags,
    ChannelPolicy,
)
from oss.src.core.channels.service import ChannelsService

pytestmark = pytest.mark.asyncio


def _stored_connection() -> ChannelConnection:
    return ChannelConnection(
        id=uuid4(),
        channel="slack",
        external_key=uuid4(),
        slug="agenta-1a2b3c",
        name="Agenta",
        description="the QA workspace",
        data={
            "connection_locator": {
                "team_id": "T1",
                "api_app_id": "A1",
                "enterprise_id": "",
            },
            "bot_user_id": "UBOT",
            "credential_secret_id": "11111111-1111-4111-8111-111111111111",
        },
        flags=ChannelConnectionFlags(is_active=True, is_verified=True),
    )


def _service_for_connection(existing: ChannelConnection):
    dao = MagicMock()
    dao.fetch_connection = AsyncMock(return_value=existing)
    dao.edit_connection = AsyncMock(side_effect=lambda **kw: kw["connection"])
    service = ChannelsService(
        channels_dao=dao, adapter_registry=ChannelAdapterRegistry(adapters={})
    )
    return service, dao


async def test_a_rename_keeps_the_credential_reference_and_the_locator():
    existing = _stored_connection()
    service, dao = _service_for_connection(existing)

    await service.edit_connection(
        project_id=uuid4(),
        user_id=uuid4(),
        connection=ChannelConnectionEdit(id=existing.id, name="Agenta (prod)"),
    )

    written = dao.edit_connection.call_args.kwargs["connection"]
    assert written.name == "Agenta (prod)"
    assert written.description == existing.description
    assert written.slug == existing.slug
    assert written.data == existing.data
    assert written.flags == existing.flags


async def test_a_partial_data_edit_merges_instead_of_replacing():
    existing = _stored_connection()
    service, dao = _service_for_connection(existing)

    await service.edit_connection(
        project_id=uuid4(),
        user_id=uuid4(),
        connection=ChannelConnectionEdit(id=existing.id, data={"note": "hello"}),
    )

    written = dao.edit_connection.call_args.kwargs["connection"]
    assert written.data["note"] == "hello"
    assert written.data["credential_secret_id"] == existing.data["credential_secret_id"]
    assert written.data["connection_locator"] == existing.data["connection_locator"]


async def test_a_flags_edit_changes_only_the_flag_it_names():
    existing = _stored_connection()
    service, dao = _service_for_connection(existing)

    await service.edit_connection(
        project_id=uuid4(),
        user_id=uuid4(),
        connection=ChannelConnectionEdit(
            id=existing.id, flags=ChannelConnectionFlags(is_active=False)
        ),
    )

    written = dao.edit_connection.call_args.kwargs["connection"]
    assert written.flags.is_active is False
    # verification is a fact about the row, not something a caller resets by omission
    assert written.flags.is_verified is True


def _stored_agent() -> ChannelAgent:
    return ChannelAgent(
        id=uuid4(),
        slug="qa",
        name="QA",
        connection_id=uuid4(),
        created_by_id=uuid4(),
        data=ChannelAgentData(
            references={"workflow_variant": {"id": str(uuid4())}},
            policy=ChannelPolicy(forwardfill=True),
        ),
        flags=ChannelAgentFlags(is_active=True, is_default=True),
    )


def _service_for_agent(existing: ChannelAgent):
    dao = MagicMock()
    dao.fetch_agent = AsyncMock(return_value=existing)
    dao.edit_agent = AsyncMock(side_effect=lambda **kw: kw["agent"])
    service = ChannelsService(
        channels_dao=dao, adapter_registry=ChannelAdapterRegistry(adapters={})
    )
    return service, dao


async def test_a_policy_only_edit_keeps_the_agent_the_default():
    existing = _stored_agent()
    service, dao = _service_for_agent(existing)

    await service.edit_agent(
        project_id=uuid4(),
        user_id=uuid4(),
        agent=ChannelAgentEdit(
            id=existing.id,
            data=ChannelAgentData(
                references=existing.data.references,
                policy=ChannelPolicy(forwardfill=False),
            ),
        ),
    )

    written = dao.edit_agent.call_args.kwargs["agent"]
    assert written.flags.is_default is True
    assert written.data.policy.forwardfill is False
    assert written.name == existing.name


async def test_a_rename_keeps_the_agent_references_and_policy():
    existing = _stored_agent()
    service, dao = _service_for_agent(existing)

    await service.edit_agent(
        project_id=uuid4(),
        user_id=uuid4(),
        agent=ChannelAgentEdit(id=existing.id, name="Triage"),
    )

    written = dao.edit_agent.call_args.kwargs["agent"]
    assert written.name == "Triage"
    assert written.data == existing.data
    assert written.flags == existing.flags


async def test_editing_an_unknown_agent_returns_none():
    service, dao = _service_for_agent(_stored_agent())
    dao.fetch_agent = AsyncMock(return_value=None)

    result = await service.edit_agent(
        project_id=uuid4(),
        user_id=uuid4(),
        agent=ChannelAgentEdit(id=uuid4(), name="x"),
    )

    assert result is None
    dao.edit_agent.assert_not_awaited()
