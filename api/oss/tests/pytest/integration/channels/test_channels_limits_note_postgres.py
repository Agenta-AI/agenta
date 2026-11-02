"""Channel limits end to end against real Postgres and the fake Slack Web API:
the inbox worker refuses a person not on the agent's list, sends one private
note a day, and opens no turn."""

import uuid

import pytest
from sqlalchemy import text

from oss.src.core.channels.adapters.registry import ChannelAdapterRegistry
from oss.src.core.channels.dtos import (
    ChannelAgentCreate,
    ChannelAgentData,
    ChannelAgentFlags,
    ChannelEventKind,
    ChannelEventOrigin,
    ChannelInboxEventCreate,
    ChannelInboxEventData,
    ChannelInboxEventProcessed,
    ChannelSpaceKind,
)
from oss.src.core.channels.service import ChannelsService
from oss.src.dbs.postgres.channels.dao import ChannelsDAO
from oss.src.tasks.asyncio.channels.inbox import InboxDispatcher

from oss.tests.pytest.unit.channels.slack.fake_slack import make_adapter_and_workspace
from oss.tests.pytest.utils.sharing import NoopRunAdmission

pytestmark = pytest.mark.integration


async def _setup(channels_scope, *, senders):
    adapter, workspace, _ = make_adapter_and_workspace()
    adapter.resolve_sender_names = False
    workspace.add_channel(id="C1", name="random")
    dao = ChannelsDAO(engine=channels_scope["engine"])
    service = ChannelsService(
        channels_dao=dao,
        adapter_registry=ChannelAdapterRegistry(adapters={"slack": adapter}),
    )
    async with channels_scope["engine"].session() as session:
        await session.execute(
            text("UPDATE channel_connections SET data = :data WHERE id = :id"),
            {
                "data": '{"bot_token": "xoxb-fake", "team_id": "T-fake"}',
                "id": channels_scope["connection_id"],
            },
        )
        await session.commit()
    await dao.create_agent(
        project_id=channels_scope["project_id"],
        user_id=channels_scope["user_id"],
        agent=ChannelAgentCreate(
            connection_id=channels_scope["connection_id"],
            slug="triage",
            data=ChannelAgentData.model_validate(
                {
                    "references": {"workflow_revision": {"id": str(uuid.uuid4())}},
                    "audience": {"senders": senders},
                }
            ),
            flags=ChannelAgentFlags(is_default=True),
        ),
    )
    invoked = []

    async def _invoke(**kwargs):
        invoked.append(kwargs)
        return "run"

    dispatcher = InboxDispatcher(
        channels_service=service,
        run_admission=NoopRunAdmission(),
        invoke_fn=_invoke,
    )
    return dispatcher, dao, workspace, invoked


async def _message(dao, channels_scope, *, external_id, sender, kind, locator):
    return await dao.record_inbox_event(
        project_id=channels_scope["project_id"],
        event=ChannelInboxEventCreate(
            connection_id=channels_scope["connection_id"],
            external_id=external_id,
            kind=ChannelEventKind.MESSAGE,
            origin=ChannelEventOrigin.PUSHED,
            data=ChannelInboxEventData(
                external_locator=locator,
                processed=ChannelInboxEventProcessed(
                    content=[{"type": "text", "text": "hello"}],
                    sender={"id": sender},
                ),
                space_kind=kind,
                addressed=True,
            ),
        ),
    )


async def _dispatch(dispatcher, dao, channels_scope, **kwargs):
    event = await _message(dao, channels_scope, **kwargs)
    await dispatcher.dispatch_event(
        project_id=channels_scope["project_id"],
        connection_id=channels_scope["connection_id"],
        event=event,
    )
    return event


CHANNEL = {"team": "T-fake", "channel": "C1", "thread_ts": "1.1"}


async def test_a_person_not_on_the_list_gets_one_ephemeral_note_a_day(channels_scope):
    dispatcher, dao, workspace, invoked = await _setup(channels_scope, senders=["UANA"])

    await _dispatch(
        dispatcher,
        dao,
        channels_scope,
        external_id="e1",
        sender="UBEN",
        kind=ChannelSpaceKind.TOPIC,
        locator=CHANNEL,
    )
    await _dispatch(
        dispatcher,
        dao,
        channels_scope,
        external_id="e2",
        sender="UBEN",
        kind=ChannelSpaceKind.TOPIC,
        locator={**CHANNEL, "thread_ts": "2.2"},
    )

    assert workspace.ephemerals == [
        {
            "channel": "C1",
            "user": "UBEN",
            "text": "This agent only answers chosen people. Ask its owner in Agenta to add you.",
            "thread_ts": "1.1",
        }
    ]
    assert workspace.messages == {}  # nothing anyone else can see
    assert invoked == []  # no turn


async def test_a_refused_message_is_not_stored_as_context(channels_scope):
    dispatcher, dao, _, _ = await _setup(channels_scope, senders=["UANA"])

    event = await _dispatch(
        dispatcher,
        dao,
        channels_scope,
        external_id="e1",
        sender="UBEN",
        kind=ChannelSpaceKind.TOPIC,
        locator=CHANNEL,
    )

    async with channels_scope["engine"].session() as session:
        space_id = (
            await session.execute(
                text(
                    "SELECT space_id FROM channel_inbox_events "
                    "WHERE project_id = :project_id AND id = :id"
                ),
                {"project_id": channels_scope["project_id"], "id": event.id},
            )
        ).scalar_one()
    assert space_id is None


async def test_a_person_on_the_list_is_answered(channels_scope):
    """The positive control: the same setup answers Ana and sends no note."""

    dispatcher, dao, workspace, invoked = await _setup(channels_scope, senders=["UANA"])

    await _dispatch(
        dispatcher,
        dao,
        channels_scope,
        external_id="e1",
        sender="UANA",
        kind=ChannelSpaceKind.TOPIC,
        locator=CHANNEL,
    )

    assert len(invoked) == 1
    assert workspace.ephemerals == []
