"""The outbox driving the real DiscordAdapter over the fake Discord API: the
first answer opens the thread under the mention, typing instead of a
"Thinking…" message, long answers as several messages, and an approval whose
buttons carry the choice token and are removed once it is answered."""

import asyncio
from uuid import uuid4

import httpx
import pytest
from oss.src.core.channels.adapters.discord.adapter import DiscordAdapter
from oss.src.core.channels.adapters.registry import ChannelAdapterRegistry
from oss.src.core.channels.dtos import (
    ChannelConnection,
    ChannelSpace,
    ChannelSpaceData,
    ChannelSpaceKind,
)
from oss.src.core.channels.service import ChannelsService

from ..test_channels_outbox_worker import PROJECT_ID, FakeRecordsDAO
from ..whatsapp.test_whatsapp_outbox import WhatsAppDAO, _answer, _end, _start, _worker
from . import payloads as p
from .fake_discord import BASE_URL, FakeDiscord

LOCATOR = {
    "guild_id": p.GUILD_ID,
    "channel_id": p.CHANNEL_ID,
    "thread_id": p.MESSAGE_ID,
    "source_channel_id": p.CHANNEL_ID,
    "message_id": p.MESSAGE_ID,
    "thread_name": "@supportbot where is my order?",
}


class DiscordDAO(WhatsAppDAO):
    def seed_discord(self):
        connection = ChannelConnection(
            id=uuid4(),
            slug="discord-support",
            channel="discord",
            external_key=uuid4(),
            data={
                "connection_locator": {"application_id": p.APPLICATION_ID},
                "bot_token": p.BOT_TOKEN,
                "bot_user_id": p.BOT_USER_ID,
            },
        )
        self.connections[connection.id] = connection
        space = ChannelSpace(
            id=uuid4(),
            connection_id=connection.id,
            kind=ChannelSpaceKind.TOPIC,
            external_key=uuid4(),
            data=ChannelSpaceData(external_locator=LOCATOR),
        )
        self.spaces[space.id] = space
        thread = self.seed_thread(
            space_id=space.id, session_id=str(uuid4()), external_locator=LOCATOR
        )
        return connection, space, thread


@pytest.fixture
def discord():
    return FakeDiscord()


@pytest.fixture
def dao():
    return DiscordDAO()


@pytest.fixture
def records():
    return FakeRecordsDAO()


@pytest.fixture
def service(dao, discord):
    client = httpx.AsyncClient(
        transport=httpx.ASGITransport(app=discord.app), base_url=BASE_URL
    )
    return ChannelsService(
        channels_dao=dao,
        adapter_registry=ChannelAdapterRegistry(
            adapters={"discord": DiscordAdapter(http_client=client)}
        ),
    )


async def test_turn_start_shows_typing_and_posts_nothing(
    service, dao, discord, records
):
    worker = _worker(service, records)
    _, _, thread = dao.seed_discord()

    await _start(worker, thread, "t1")
    await asyncio.sleep(0.05)
    await worker.stop_progress("t1")

    assert discord.sent == []
    assert discord.typing == [p.CHANNEL_ID]


async def test_the_answer_opens_a_thread_under_the_mention(
    service, dao, discord, records
):
    worker = _worker(service, records)
    _, _, thread = dao.seed_discord()

    _answer(records, thread, "t1", "It left yesterday.")
    await _end(worker, thread, "t1")

    assert [t["message_id"] for t in discord.threads_started] == [p.MESSAGE_ID]
    assert discord.texts_in(p.MESSAGE_ID) == ["It left yesterday."]


async def test_a_long_answer_goes_out_as_three_messages(service, dao, discord, records):
    worker = _worker(service, records)
    _, _, thread = dao.seed_discord()
    paragraph = ("word " * 179).strip() + "."
    _answer(records, thread, "t1", "\n\n".join([paragraph] * 5))

    await _end(worker, thread, "t1")

    parts = discord.texts_in(p.MESSAGE_ID)
    assert len(parts) == 3
    assert all(len(part) <= 2000 for part in parts)


async def test_an_approval_carries_the_choice_token_and_is_dismissed_once_answered(
    service, dao, discord, records
):
    worker = _worker(service, records)
    connection, _, thread = dao.seed_discord()
    records.seed(
        session_id=thread.session_id,
        turn_id="t1",
        record_type="interaction_request",
        attributes={
            "id": "int-1",
            "payload": {
                "toolCall": {"name": "cancel_order", "rawInput": {"order": "4411"}}
            },
        },
    )
    records.seed(
        session_id=thread.session_id,
        turn_id="t1",
        record_type="done",
        attributes={"stopReason": "paused"},
    )

    await _end(worker, thread, "t1")

    [message] = [m for m in discord.sent if m.get("components")]
    buttons = message["components"][0]["components"]
    pending = dao.threads[thread.id].data.pending_choice
    assert [b["custom_id"] for b in buttons] == [
        f"{pending.interaction_id}:approve",
        f"{pending.interaction_id}:deny",
    ]
    assert "4411" in message["content"]

    await service.dismiss_approval_choices(
        project_id=PROJECT_ID,
        connection_id=connection.id,
        thread=dao.threads[thread.id],
        interaction_id=pending.interaction_id,
    )

    assert discord.edits == [
        {
            "channel_id": p.MESSAGE_ID,
            "message_id": message["id"],
            "components": [],
        }
    ]
