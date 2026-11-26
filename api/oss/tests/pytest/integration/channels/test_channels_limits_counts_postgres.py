"""Channel limits add no statements to a message the agent answers.

Counts the SQL statements `ChannelsService.resolve` sends for one allowed
message, against real Postgres, with and without limits. The expected numbers
were measured on the code before the change (main at aaa2701a6f) with this
same file: an allowed message must cost exactly what it cost then.
"""

import uuid

import pytest

from oss.src.core.channels.adapters.registry import ChannelAdapterRegistry
from oss.src.core.channels.dtos import (
    ChannelAgentCreate,
    ChannelAgentData,
    ChannelEventKind,
    ChannelEventOrigin,
    ChannelGrantCreate,
    ChannelGrantData,
    ChannelGrantEffect,
    ChannelInboxEventCreate,
    ChannelInboxEventData,
    ChannelInboxEventProcessed,
    ChannelSpaceCreate,
    ChannelSpaceData,
    ChannelSpaceKind,
)
from oss.src.core.channels.service import ChannelsService
from oss.src.core.channels.utils import ChannelKeyGrain, compose_external_key
from oss.src.dbs.postgres.channels.dao import ChannelsDAO

from oss.tests.pytest.unit.channels.contract.fakes import WellBehavedFakeAdapter
from oss.tests.pytest.utils.statements import count_statements

pytestmark = pytest.mark.integration

LOCATOR = {"team": "T1", "channel": "C1", "thread_ts": "1000.1"}

# Measured with this file on main at aaa2701a6f, before the change: statements
# for (a first message that opens a thread, a follow-up in that thread). With no
# rule the agent also counts its rules; a rule that names the place skips that.
EXPECTED = {
    "no-limits": (14, 10),
    "people-list": (14, 10),
    "only-these-channels": (13, 9),
    "people-and-channels": (13, 9),
}


async def _setup(channels_scope, *, audience=None, chosen_channel=False):
    adapter = WellBehavedFakeAdapter()
    dao = ChannelsDAO(engine=channels_scope["engine"])
    service = ChannelsService(
        channels_dao=dao,
        adapter_registry=ChannelAdapterRegistry(adapters={"slack": adapter}),
    )
    project_id = channels_scope["project_id"]
    connection_id = channels_scope["connection_id"]
    capabilities = await adapter.fetch_capabilities()
    space = await dao.create_space(
        project_id=project_id,
        user_id=uuid.uuid4(),
        space=ChannelSpaceCreate(
            connection_id=connection_id,
            kind=ChannelSpaceKind.TOPIC,
            external_key=compose_external_key(
                capabilities, ChannelKeyGrain.SPACE, LOCATOR
            ),
            data=ChannelSpaceData(external_locator=LOCATOR),
        ),
    )
    data = {"references": {"workflow_revision": {"id": str(uuid.uuid4())}}}
    if audience is not None:
        # older code ignores the block, so this file runs on both versions
        data["audience"] = {"senders": audience}
    agent = await dao.create_agent(
        project_id=project_id,
        user_id=uuid.uuid4(),
        agent=ChannelAgentCreate(
            connection_id=connection_id,
            slug="triage",
            data=ChannelAgentData.model_validate(data),
        ),
    )
    if chosen_channel:
        # "Only these channels: #C1", with DMs on
        for grant in (
            ChannelGrantCreate(
                agent_id=agent.id,
                effect=ChannelGrantEffect.ALLOW,
                kind=ChannelSpaceKind.PRIVATE,
                data=ChannelGrantData(),
            ),
            ChannelGrantCreate(
                agent_id=agent.id,
                effect=ChannelGrantEffect.ALLOW,
                space_id=space.id,
                data=ChannelGrantData(),
            ),
        ):
            await dao.create_grant(
                project_id=project_id, user_id=uuid.uuid4(), grant=grant
            )
    return service, dao


async def _event(dao, channels_scope, *, external_id):
    return await dao.record_inbox_event(
        project_id=channels_scope["project_id"],
        event=ChannelInboxEventCreate(
            connection_id=channels_scope["connection_id"],
            external_id=external_id,
            kind=ChannelEventKind.MESSAGE,
            origin=ChannelEventOrigin.PUSHED,
            data=ChannelInboxEventData(
                external_locator=LOCATOR,
                processed=ChannelInboxEventProcessed(
                    content=[{"type": "text", "text": "~triage hello"}],
                    sender={"id": "U1"},
                ),
                space_kind=ChannelSpaceKind.TOPIC,
            ),
        ),
    )


async def _count(service, dao, channels_scope, external_id):
    event = await _event(dao, channels_scope, external_id=external_id)
    with count_statements(channels_scope["engine"]) as statements:
        resolution = await service.resolve(
            project_id=channels_scope["project_id"],
            connection_id=channels_scope["connection_id"],
            event=event,
        )
    assert resolution is not None
    return len(statements)


@pytest.mark.parametrize(
    "case,limits",
    [
        ("no-limits", {}),
        ("people-list", {"audience": ["U1", "U2"]}),
        ("only-these-channels", {"chosen_channel": True}),
        ("people-and-channels", {"audience": ["U1"], "chosen_channel": True}),
    ],
)
async def test_an_allowed_message_costs_what_it_cost_before(
    channels_scope, case, limits
):
    service, dao = await _setup(channels_scope, **limits)

    first = await _count(service, dao, channels_scope, "ev-1")
    follow_up = await _count(service, dao, channels_scope, "ev-2")

    assert (first, follow_up) == EXPECTED[case]
