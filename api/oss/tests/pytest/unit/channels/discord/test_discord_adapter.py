"""DiscordAdapter against the fake Discord API: the token and intent checks,
the invite link, parsing over the socket, and the outbound REST calls."""

from uuid import uuid4

import httpx
import pytest
from oss.src.core.channels.adapters.discord.adapter import DiscordAdapter
from oss.src.core.channels.dtos import (
    ChannelConnection,
    ChannelConnectionCreate,
    ChannelRequestContext,
)
from oss.src.core.channels.types import (
    ChannelConnectionVerificationFailed,
    ChannelCredentialRevoked,
)

from . import payloads as p
from .fake_discord import BASE_URL, FakeDiscord, answer


@pytest.fixture
def discord():
    return FakeDiscord()


@pytest.fixture
def adapter(discord):
    client = httpx.AsyncClient(
        transport=httpx.ASGITransport(app=discord.app), base_url=BASE_URL
    )
    return DiscordAdapter(http_client=client)


def _connection(**data):
    return ChannelConnection(
        id=uuid4(),
        slug="discord-support",
        channel="discord",
        external_key=uuid4(),
        data={
            "connection_locator": {"application_id": p.APPLICATION_ID},
            "bot_token": p.BOT_TOKEN,
            "bot_user_id": p.BOT_USER_ID,
            "bot_username": p.BOT_USERNAME,
            **data,
        },
    )


async def _verify(adapter, token=p.BOT_TOKEN):
    return await adapter.verify_connection(
        connection=ChannelConnectionCreate(channel="discord"),
        credentials={"bot_token": token},
    )


# --- setup --------------------------------------------------------------- #


async def test_verify_connection_reads_the_application(adapter):
    assert await _verify(adapter) == {
        "application_id": p.APPLICATION_ID,
        "bot_user_id": p.BOT_USER_ID,
        "bot_username": p.BOT_USERNAME,
        "application_name": p.APPLICATION_NAME,
    }


async def test_verify_connection_accepts_the_limited_intent(adapter, discord):
    discord.flags = p.MESSAGE_CONTENT_LIMITED_FLAG

    assert (await _verify(adapter))["application_id"] == p.APPLICATION_ID


async def test_verify_connection_refuses_a_rejected_token(adapter):
    with pytest.raises(ChannelConnectionVerificationFailed, match="rejected"):
        await _verify(adapter, token="wrong")


async def test_verify_connection_refuses_when_the_intent_is_off(adapter, discord):
    discord.flags = 0

    with pytest.raises(ChannelConnectionVerificationFailed, match="Message Content"):
        await _verify(adapter)


async def test_verify_connection_accepts_once_the_intent_is_on(adapter, discord):
    discord.flags = 0
    with pytest.raises(ChannelConnectionVerificationFailed):
        await _verify(adapter)

    discord.flags = p.MESSAGE_CONTENT_FLAG
    assert (await _verify(adapter))["application_id"] == p.APPLICATION_ID


async def test_the_setup_document_is_the_invite_link(adapter):
    document = await adapter.build_setup_document(
        request_url="https://agenta.example/api",
        locator={"application_id": "123"},
    )

    url = "https://discord.com/oauth2/authorize?client_id=123&scope=bot&permissions=309237763136"
    assert (document.format, document.content, document.link) == ("url", url, url)


async def test_no_setup_document_before_a_connection_exists(adapter):
    assert await adapter.build_setup_document(request_url="x") is None


async def test_there_is_no_http_ingress(adapter):
    request = ChannelRequestContext(headers={}, path="/", body=b"{}")

    assert adapter.connection_locator(request=request) is None
    with pytest.raises(NotImplementedError):
        await adapter.verify_signature(request=request, connection=_connection())


# --- parsing ------------------------------------------------------------- #


async def _parse(adapter, payload, connection=None):
    return await adapter.parse_event(
        body=p.encode(payload), connection=connection or _connection()
    )


async def test_a_mention_parses_without_a_channel_read(adapter, discord):
    event = await _parse(adapter, p.mention())

    assert event.addressed is True
    assert event.external_locator["thread_id"] == p.MESSAGE_ID
    assert discord.channel_reads == []


async def test_a_thread_message_reads_its_parent_once_per_connection(adapter, discord):
    discord.add_thread(p.THREAD_ID)
    connection = _connection()

    first = await _parse(adapter, p.in_thread("one", message_id="11"), connection)
    second = await _parse(adapter, p.in_thread("two", message_id="12"), connection)

    assert first.external_locator["channel_id"] == p.CHANNEL_ID
    assert second.external_locator["thread_id"] == p.THREAD_ID
    assert discord.channel_reads == [p.THREAD_ID]


async def test_a_message_without_a_channel_type_reads_the_channel(adapter, discord):
    event = await _parse(adapter, p.message("hi", channel_type=None))

    assert event.external_locator["channel_id"] == p.CHANNEL_ID
    assert discord.channel_reads == [p.CHANNEL_ID]


async def test_the_bots_own_answer_is_dropped(adapter, discord):
    assert await _parse(adapter, p.message("answer", author=p.BOT_AUTHOR)) is None


async def test_other_dispatches_are_dropped(adapter):
    assert await _parse(adapter, {"t": "TYPING_START", "d": {}}) is None
    assert await adapter.parse_event(body=b"not json") is None


async def test_a_click_is_acknowledged_with_a_deferred_update(adapter, discord):
    event = await _parse(adapter, p.click("int-1:approve"))

    assert event.processed.content[0]["text"] == "int-1:approve"
    assert discord.callbacks == [
        {
            "interaction_id": "1400000000000000001",
            "token": "fake-interaction-token",
            "type": 6,
        }
    ]


# --- outbound ------------------------------------------------------------ #


def _mention_locator():
    return {
        "guild_id": p.GUILD_ID,
        "channel_id": p.CHANNEL_ID,
        "thread_id": p.MESSAGE_ID,
        "source_channel_id": p.CHANNEL_ID,
        "message_id": p.MESSAGE_ID,
        "thread_name": "@supportbot where is my order?",
    }


async def _post(adapter, locator, text="Here it is."):
    return await adapter.post_message(
        connection=_connection(),
        locator=locator,
        content=[{"type": "text", "text": text}],
        idempotency_key=uuid4(),
    )


async def test_the_first_reply_starts_the_thread_from_the_mention(adapter, discord):
    receipt = await _post(adapter, _mention_locator())

    assert discord.threads_started == [
        {
            "channel_id": p.CHANNEL_ID,
            "message_id": p.MESSAGE_ID,
            "name": "@supportbot where is my order?",
        }
    ]
    assert discord.texts_in(p.MESSAGE_ID) == ["Here it is."]
    assert receipt == {"channel_id": p.MESSAGE_ID, "message_id": discord.sent[0]["id"]}


async def test_a_later_reply_goes_into_the_existing_thread(adapter, discord):
    await _post(adapter, _mention_locator(), "one")
    await _post(adapter, _mention_locator(), "two")

    assert len(discord.threads_started) == 1
    assert discord.texts_in(p.MESSAGE_ID) == ["one", "two"]


async def test_a_dm_reply_goes_to_the_dm(adapter, discord):
    locator = {"guild_id": "", "channel_id": p.DM_CHANNEL_ID}

    await _post(adapter, locator, "hi")

    assert discord.texts_in(p.DM_CHANNEL_ID) == ["hi"]
    assert discord.threads_started == []


async def test_a_refused_token_marks_the_credential_revoked(adapter, discord):
    discord.token = "rotated"

    with pytest.raises(ChannelCredentialRevoked):
        await _post(adapter, {"guild_id": "", "channel_id": p.DM_CHANNEL_ID})


async def test_dismiss_choices_removes_the_buttons(adapter, discord):
    await adapter.dismiss_choices(
        connection=_connection(),
        external_locator={"channel_id": p.THREAD_ID, "message_id": "77"},
    )

    assert discord.edits == [
        {"channel_id": p.THREAD_ID, "message_id": "77", "components": []}
    ]


async def test_typing_shows_in_the_channel_until_the_thread_exists(adapter, discord):
    await adapter.signal_activity(connection=_connection(), locator=_mention_locator())
    await _post(adapter, _mention_locator())
    await adapter.signal_activity(connection=_connection(), locator=_mention_locator())

    assert discord.typing == [p.CHANNEL_ID, p.MESSAGE_ID]


async def test_message_status_reacts_on_the_users_message(adapter, discord):
    connection = _connection()
    for status in ("received", "completed"):
        await adapter.set_message_status(
            connection=connection, locator=_mention_locator(), status=status
        )

    assert [(r["method"], r["emoji"]) for r in discord.reactions] == [
        ("PUT", "👀"),
        ("PUT", "✅"),
        ("DELETE", "👀"),
    ]
    assert {(r["channel_id"], r["message_id"]) for r in discord.reactions} == {
        (p.CHANNEL_ID, p.MESSAGE_ID)
    }


async def test_fetch_history_reads_the_channel(adapter, discord):
    answer(discord, p.CHANNEL_ID, "older")
    answer(discord, p.CHANNEL_ID, "newer")
    answer(discord, p.CHANNEL_ID, "mine", author=p.BOT_AUTHOR)

    events = await adapter.fetch_history(
        connection=_connection(),
        locator={"guild_id": p.GUILD_ID, "channel_id": p.CHANNEL_ID},
        limit=50,
    )

    assert [e.processed.content[0]["text"] for e in events] == ["newer", "older"]
    assert all(e.external_locator["channel_id"] == p.CHANNEL_ID for e in events)


async def test_discover_spaces_returns_nothing(adapter):
    assert await adapter.discover_spaces(connection=_connection()) == []
