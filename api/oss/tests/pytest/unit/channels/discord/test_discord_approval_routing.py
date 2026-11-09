"""A Discord button click, parsed by the real adapter, routed by the real
`ChannelsService.resolve`: it finds the thread the mention opened, resolves
the pending choice by its token, and a stale click starts no turn."""

from datetime import datetime, timezone
from unittest.mock import AsyncMock
from uuid import uuid4

import httpx
from oss.src.core.channels.adapters.discord.adapter import DiscordAdapter
from oss.src.core.channels.adapters.discord.capabilities import (
    fetch_discord_capabilities,
)
from oss.src.core.channels.adapters.discord.mapping import build_locator
from oss.src.core.channels.adapters.registry import ChannelAdapterRegistry
from oss.src.core.channels.dtos import (
    ChannelConnection,
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
from . import payloads as p
from .fake_discord import BASE_URL, FakeDiscord

INTERACTION_ID = "0193a3f0-6d3c-7b3e-9c1f-2a7e5d4b8c10"
# The thread the bot opened from the mention, so the thread id is the
# mention's message id.
MENTION = build_locator(
    guild_id=p.GUILD_ID, source_channel_id=p.CHANNEL_ID, message_id=p.THREAD_ID
)


def _connection():
    return ChannelConnection(
        id=uuid4(),
        slug="discord-support",
        channel="discord",
        external_key=uuid4(),
        flags=ChannelConnectionFlags(is_verified=True),
        data={"bot_token": p.BOT_TOKEN, "bot_user_id": p.BOT_USER_ID},
    )


def _world(pending_interaction_id):
    capabilities = fetch_discord_capabilities()
    connection = _connection()
    agent = _make_agent(slug="support")
    space = ChannelSpace(
        id=uuid4(),
        connection_id=connection.id,
        kind=ChannelSpaceKind.TOPIC,
        external_key=compose_external_key(capabilities, ChannelKeyGrain.SPACE, MENTION),
        data=ChannelSpaceData(external_locator=MENTION),
        flags=ChannelSpaceFlags(is_backfilled=True),
    )
    thread = ChannelThread(
        id=uuid4(),
        space_id=space.id,
        agent_id=agent.id,
        external_key=compose_external_key(
            capabilities, ChannelKeyGrain.THREAD, MENTION
        ),
        session_id="sess-1",
        data=ChannelThreadData(
            external_locator=MENTION,
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
    fake = FakeDiscord()
    adapter = DiscordAdapter(
        http_client=httpx.AsyncClient(
            transport=httpx.ASGITransport(app=fake.app), base_url=BASE_URL
        )
    )
    service = ChannelsService(
        channels_dao=dao,
        adapter_registry=ChannelAdapterRegistry(adapters={"discord": adapter}),
    )
    return service, dao, adapter, connection, thread


async def _click(service, adapter, connection, custom_id):
    inbound = await adapter.parse_event(
        body=p.encode(p.click(custom_id)), connection=connection
    )
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


async def test_a_click_resolves_the_pending_choice_in_the_mentions_thread():
    service, dao, adapter, connection, thread = _world(INTERACTION_ID)

    resolution = await _click(service, adapter, connection, f"{INTERACTION_ID}:approve")

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

    resolution = await _click(service, adapter, connection, f"{INTERACTION_ID}:approve")

    assert resolution is None
    dao.create_thread.assert_not_called()


async def test_a_new_channel_space_is_named_after_the_channel():
    service, dao, adapter, connection, _ = _world(INTERACTION_ID)
    dao.fetch_space_by_key = AsyncMock(return_value=None)
    inbound = await adapter.parse_event(
        body=p.encode(p.mention()), connection=connection
    )
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

    await service.resolve(project_id=uuid4(), connection_id=connection.id, event=event)

    created = dao.get_or_create_space.call_args.kwargs["space"]
    assert created.name == p.CHANNEL_NAME
    assert created.kind is ChannelSpaceKind.TOPIC


async def _route_message(service, adapter, connection, payload):
    inbound = await adapter.parse_event(body=p.encode(payload), connection=connection)
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


async def test_a_mention_of_the_bots_role_opens_a_turn():
    service, _, adapter, connection, _ = _world(INTERACTION_ID)

    resolution = await _route_message(
        service, adapter, connection, p.role_mention("where is my order?")
    )

    assert resolution is not None


async def test_a_mention_of_another_role_opens_no_turn():
    service, _, adapter, connection, _ = _world(INTERACTION_ID)

    resolution = await _route_message(
        service,
        adapter,
        connection,
        p.role_mention("where is my order?", role_id=p.OTHER_ROLE_ID),
    )

    assert resolution is None
