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
from oss.src.core.channels.utils import delivery_outcome_unknown, delivery_refused

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
    assert (document.format, document.content, document.link) == ("text", url, url)


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


async def test_a_mention_carries_the_channel_name(adapter, discord):
    event = await _parse(adapter, p.mention())

    assert event.addressed is True
    assert event.external_locator["thread_id"] == p.MESSAGE_ID
    assert event.external_locator["title"] == p.CHANNEL_NAME
    assert discord.channel_reads == [p.CHANNEL_ID]


async def test_a_thread_message_reads_its_channels_once_per_connection(
    adapter, discord
):
    discord.add_thread(p.THREAD_ID)
    connection = _connection()

    first = await _parse(adapter, p.in_thread("one", message_id="11"), connection)
    second = await _parse(adapter, p.in_thread("two", message_id="12"), connection)

    assert first.external_locator["channel_id"] == p.CHANNEL_ID
    assert first.external_locator["title"] == p.CHANNEL_NAME
    assert second.external_locator["thread_id"] == p.THREAD_ID
    assert discord.channel_reads == [p.THREAD_ID, p.CHANNEL_ID]


async def test_a_mention_of_the_bots_role_addresses_the_bot(adapter, discord):
    connection = _connection()
    event = await _parse(adapter, p.role_mention("hello"), connection)
    again = await _parse(adapter, p.role_mention("again", message_id="13"), connection)

    assert event.addressed is True
    assert event.processed.content == [
        {"type": "text", "text": f"@{p.BOT_USERNAME} hello"}
    ]
    assert again.addressed is True
    assert discord.role_reads == [p.GUILD_ID]


async def test_a_mention_of_another_role_does_not_address_the_bot(adapter, discord):
    event = await _parse(adapter, p.role_mention(role_id=p.OTHER_ROLE_ID))

    assert event.addressed is False
    assert f"<@&{p.OTHER_ROLE_ID}>" in event.processed.content[0]["text"]


async def test_a_direct_mention_does_not_wait_on_the_roles(adapter, discord):
    discord.fail_role_reads = True
    payload = p.mention("hello")
    payload["d"]["mention_roles"] = [p.OTHER_ROLE_ID]

    event = await _parse(adapter, payload)

    assert event.addressed is True
    assert discord.role_reads == []


async def test_the_bots_role_is_read_again_after_it_expires(
    adapter, discord, monkeypatch
):
    from oss.src.core.channels.adapters.discord import adapter as module

    now = [1000.0]
    monkeypatch.setattr(module.time, "monotonic", lambda: now[0])
    connection = _connection()
    await _parse(adapter, p.role_mention(), connection)

    # The bot was removed and invited again, and Discord made a new role.
    discord.roles[-1]["id"] = "1100000000000000099"
    now[0] += 60
    stale = await _parse(
        adapter, p.role_mention(role_id="1100000000000000099"), connection
    )
    now[0] += module._BOT_ROLE_TTL_SECONDS
    fresh = await _parse(
        adapter, p.role_mention(role_id="1100000000000000099"), connection
    )

    assert stale.addressed is False
    assert fresh.addressed is True
    assert discord.role_reads == [p.GUILD_ID, p.GUILD_ID]


async def test_a_message_without_role_mentions_reads_no_roles(adapter, discord):
    await _parse(adapter, p.mention())

    assert discord.role_reads == []


async def test_a_dm_needs_no_channel_read(adapter, discord):
    event = await _parse(adapter, p.dm())

    assert "title" not in event.external_locator
    assert discord.channel_reads == []


async def test_the_bots_own_reply_costs_no_channel_read(adapter, discord):
    assert await _parse(adapter, p.in_thread("answer", author=p.BOT_AUTHOR)) is None
    assert discord.channel_reads == []


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


async def _post(adapter, locator, text="Here it is.", connection=None):
    return await adapter.post_message(
        connection=connection or _connection(),
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
    assert receipt == {
        "source_channel_id": p.MESSAGE_ID,
        "message_id": discord.sent[0]["id"],
    }


def _other_process(discord):
    return DiscordAdapter(
        http_client=httpx.AsyncClient(
            transport=httpx.ASGITransport(app=discord.app), base_url=BASE_URL
        )
    )


async def test_a_reply_from_another_process_finds_the_existing_thread(adapter, discord):
    connection = _connection()
    await _post(adapter, _mention_locator(), "one", connection=connection)
    await _post(
        _other_process(discord), _mention_locator(), "two", connection=connection
    )

    # the second start is answered "already created", and the post goes on
    assert discord.thread_start_attempts == [p.MESSAGE_ID, p.MESSAGE_ID]
    assert len(discord.threads_started) == 1
    assert discord.texts_in(p.MESSAGE_ID) == ["one", "two"]


async def test_a_reply_after_the_starter_message_was_deleted(adapter, discord):
    connection = _connection()
    await _post(adapter, _mention_locator(), "one", connection=connection)
    discord.deleted_messages.add(p.MESSAGE_ID)

    await _post(
        _other_process(discord), _mention_locator(), "two", connection=connection
    )

    assert discord.texts_in(p.MESSAGE_ID) == ["one", "two"]


async def test_typing_from_another_process_shows_in_the_existing_thread(
    adapter, discord
):
    connection = _connection()
    await _post(adapter, _mention_locator(), connection=connection)

    other = _other_process(discord)
    for _ in range(2):
        await other.signal_activity(connection=connection, locator=_mention_locator())
    await _post(other, _mention_locator(), "two", connection=connection)

    assert discord.typing == [p.MESSAGE_ID, p.MESSAGE_ID]
    # the typing call proved the thread exists, so the post starts nothing
    assert discord.thread_start_attempts == [p.MESSAGE_ID]


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
        external_locator={"source_channel_id": p.THREAD_ID, "message_id": "77"},
    )

    assert discord.edits == [
        {"channel_id": p.THREAD_ID, "message_id": "77", "components": []}
    ]


async def test_typing_shows_in_the_channel_until_the_thread_exists(adapter, discord):
    connection = _connection()
    await adapter.signal_activity(connection=connection, locator=_mention_locator())
    await _post(adapter, _mention_locator(), connection=connection)
    await adapter.signal_activity(connection=connection, locator=_mention_locator())

    assert discord.typing == [p.CHANNEL_ID, p.MESSAGE_ID]


async def test_a_later_reply_in_the_same_process_starts_no_thread(adapter, discord):
    connection = _connection()
    await _post(adapter, _mention_locator(), "one", connection=connection)
    await _post(adapter, _mention_locator(), "two", connection=connection)

    assert discord.thread_start_attempts == [p.MESSAGE_ID]
    assert discord.texts_in(p.MESSAGE_ID) == ["one", "two"]


async def test_a_failed_thread_start_is_retried_not_marked_uncertain(adapter, discord):
    connection = _connection()
    discord.fail_thread_start(503)

    with pytest.raises(Exception) as raised:
        await _post(adapter, _mention_locator(), connection=connection)

    assert not delivery_outcome_unknown(raised.value)
    assert not delivery_refused(raised.value)
    assert discord.sent == []

    await _post(adapter, _mention_locator(), connection=connection)

    assert discord.texts_in(p.MESSAGE_ID) == ["Here it is."]


async def test_a_thread_start_timeout_is_retried_not_marked_uncertain(discord):
    class _TimesOut(httpx.AsyncBaseTransport):
        async def handle_async_request(self, request):
            if request.url.path.endswith("/threads"):
                raise httpx.ReadTimeout("timed out", request=request)
            return await httpx.ASGITransport(app=discord.app).handle_async_request(
                request
            )

    adapter = DiscordAdapter(
        http_client=httpx.AsyncClient(transport=_TimesOut(), base_url=BASE_URL)
    )

    with pytest.raises(Exception) as raised:
        await _post(adapter, _mention_locator())

    assert not delivery_outcome_unknown(raised.value)
    assert not delivery_refused(raised.value)
    assert discord.sent == []


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

    assert [e.processed.content[0]["text"] for e in events] == ["older", "newer"]
    assert all(e.external_locator["channel_id"] == p.CHANNEL_ID for e in events)


async def test_an_empty_answer_posts_nothing(adapter, discord):
    receipt = await adapter.post_message(
        connection=_connection(),
        locator=_mention_locator(),
        content=[{"type": "text", "text": ""}],
        idempotency_key=uuid4(),
    )

    assert receipt == {}
    assert discord.sent == [] and discord.threads_started == []


async def test_history_shows_the_bots_role_mention_as_its_handle(adapter, discord):
    discord.history[p.CHANNEL_ID] = [p.role_mention("hello", message_id="21")["d"]]

    [event] = await adapter.fetch_history(
        connection=_connection(),
        locator={"guild_id": p.GUILD_ID, "channel_id": p.CHANNEL_ID},
        limit=50,
    )

    assert event.processed.content[0]["text"] == f"@{p.BOT_USERNAME} hello"
    assert discord.role_reads == [p.GUILD_ID]


async def test_discover_spaces_returns_nothing(adapter):
    assert await adapter.discover_spaces(connection=_connection()) == []
