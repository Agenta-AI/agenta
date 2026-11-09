"""A Teams card click, parsed by the real adapter, routed by the real
`ChannelsService.resolve`: it finds the channel thread the card was posted
in, resolves the pending choice by its token, and a stale click starts no
turn."""

from datetime import datetime, timezone
from unittest.mock import AsyncMock
from uuid import uuid4

import pytest
from oss.src.core.channels.adapters.registry import ChannelAdapterRegistry
from oss.src.core.channels.adapters.teams.capabilities import (
    fetch_teams_capabilities,
)
from oss.src.core.channels.dtos import (
    ChannelConnectionFlags,
    ChannelEventOrigin,
    ChannelInboxEvent,
    ChannelInboxEventData,
    ChannelPendingChoice,
    ChannelPendingChoiceItem,
    ChannelSpace,
    ChannelSpaceData,
    ChannelSpaceFlags,
    ChannelSpaceKind,
    ChannelThread,
    ChannelThreadData,
    ChannelThreadFlags,
)
from oss.src.core.channels.service import ChannelsService
from oss.src.core.channels.utils import ChannelKeyGrain, compose_external_key

from ..test_channels_service_routing import _make_agent, _make_fake_dao
from . import fake_teams as f
from . import payloads as p

INTERACTION_ID = "0193a3f0-6d3c-7b3e-9c1f-2a7e5d4b8c10"
ROOT = "1700000000111"
CARD_ID = "1700000000555"
THREAD = {
    "tenant_id": p.TENANT_ID,
    "conversation_id": p.CHANNEL_CONVERSATION,
    "thread_id": ROOT,
    "service_url": p.SERVICE_URL,
    "message_id": ROOT,
}


def _world(pending_interaction_id):
    capabilities = fetch_teams_capabilities()
    connection = p.connection().model_copy(
        update={"flags": ChannelConnectionFlags(is_verified=True)}
    )
    agent = _make_agent(slug="support")
    space = ChannelSpace(
        id=uuid4(),
        connection_id=connection.id,
        kind=ChannelSpaceKind.TOPIC,
        external_key=compose_external_key(capabilities, ChannelKeyGrain.SPACE, THREAD),
        data=ChannelSpaceData(external_locator=THREAD),
        flags=ChannelSpaceFlags(is_backfilled=True),
    )
    thread = ChannelThread(
        id=uuid4(),
        space_id=space.id,
        agent_id=agent.id,
        external_key=compose_external_key(capabilities, ChannelKeyGrain.THREAD, THREAD),
        session_id="sess-1",
        data=ChannelThreadData(
            external_locator=THREAD,
            pending_choice=ChannelPendingChoice(
                choices=[
                    ChannelPendingChoiceItem(
                        label="Approve", token=f"{pending_interaction_id}:approve"
                    ),
                    ChannelPendingChoiceItem(
                        label="Deny", token=f"{pending_interaction_id}:deny"
                    ),
                ],
                posted_at=datetime.now(timezone.utc),
                interaction_id=pending_interaction_id,
            ),
        ),
        flags=ChannelThreadFlags(),
    )
    dao = _make_fake_dao()
    dao.fetch_connection = AsyncMock(return_value=connection)
    dao.fetch_space_by_key = AsyncMock(return_value=space)
    dao.fetch_default_agent = AsyncMock(return_value=agent)
    dao.fetch_current_thread = AsyncMock(return_value=thread)
    adapter = f.adapter_for(f.FakeMicrosoft())
    service = ChannelsService(
        channels_dao=dao,
        adapter_registry=ChannelAdapterRegistry(adapters={"teams": adapter}),
    )
    return service, dao, adapter, connection, thread


def _channel_click(token, *, with_suffix):
    """A click on the card the adapter posted into the thread: the button
    data as `mapping.card_attachment` renders it."""

    conversation_id = p.CHANNEL_CONVERSATION
    if with_suffix:
        conversation_id = f"{conversation_id};messageid={ROOT}"
    activity = p.message(
        conversation_type="channel",
        conversation_id=conversation_id,
        activity_id="1700000000556",
        replyToId=CARD_ID,
    )
    activity.pop("text")
    activity["value"] = {"choice_token": token, "thread_id": ROOT}
    return activity


async def _click(service, adapter, connection, activity):
    inbound = await adapter.parse_event(body=p.encode(activity), connection=connection)
    event = ChannelInboxEvent(
        id=uuid4(),
        connection_id=connection.id,
        external_id=inbound.external_id,
        kind=inbound.kind,
        origin=ChannelEventOrigin.PUSHED,
        data=ChannelInboxEventData(
            external_locator=inbound.external_locator,
            processed=inbound.processed,
            space_kind=inbound.space_kind,
            addressed=inbound.addressed,
        ),
    )
    return await service.resolve(
        project_id=uuid4(), connection_id=connection.id, event=event
    )


@pytest.mark.parametrize("with_suffix", [True, False])
async def test_a_click_resolves_the_pending_choice_in_the_cards_thread(with_suffix):
    service, dao, adapter, connection, thread = _world(INTERACTION_ID)

    resolution = await _click(
        service,
        adapter,
        connection,
        _channel_click(f"{INTERACTION_ID}:approve", with_suffix=with_suffix),
    )

    assert resolution is not None
    assert resolution.thread.id == thread.id
    assert resolution.answered_interaction_id == INTERACTION_ID
    assert resolution.resolved_token == f"{INTERACTION_ID}:approve"
    assert resolution.resolved_choice == "Approve"
    assert (
        dao.fetch_current_thread.call_args.kwargs["external_key"] == thread.external_key
    )
    dao.create_thread.assert_not_called()


async def test_a_stale_click_starts_no_turn():
    service, dao, adapter, connection, _ = _world(str(uuid4()))

    resolution = await _click(
        service,
        adapter,
        connection,
        _channel_click(f"{INTERACTION_ID}:approve", with_suffix=True),
    )

    assert resolution is None
    dao.create_thread.assert_not_called()
