"""Unit tests for the Telegram adapter (custom-bot path).

Pure logic (capabilities, signature, mapping, event parsing) needs no network.
The two egress calls run against an httpx.MockTransport that answers the Bot API
shape, so "send" and "edit" are asserted against the request the adapter really
made, not a stub that ignores it.
"""

import json
from uuid import uuid4

import httpx
import pytest

from oss.src.core.channels.adapters.telegram.adapter import TelegramAdapter
from oss.src.core.channels.adapters.telegram.capabilities import (
    fetch_telegram_capabilities,
)
from oss.src.core.channels.adapters.telegram.mapping import (
    classify_space_kind,
    is_addressed,
    render_content,
    routing_token_from_path,
    to_html,
)
from oss.src.core.channels.adapters.telegram.signature import verify_telegram_secret
from oss.src.core.channels.dtos import (
    ChannelConnection,
    ChannelEventKind,
    ChannelRequestContext,
    ChannelSpaceKind,
)
from oss.src.core.channels.types import ChannelSignatureInvalid

BOT_ID = 4242
BOT_USERNAME = "agenta_bot"
WEBHOOK_SECRET = "s3cr3t-token"


def _connection(**data_overrides) -> ChannelConnection:
    data = {
        "bot_token": "123:abc",
        "bot_id": BOT_ID,
        "bot_username": BOT_USERNAME,
        "webhook_secret": WEBHOOK_SECRET,
    }
    data.update(data_overrides)
    return ChannelConnection(
        id=uuid4(),
        slug="telegram-connection",
        channel="telegram",
        external_key=uuid4(),
        data=data,
    )


def _request(body: bytes, *, headers=None, path="/telegram/events/4242/"):
    return ChannelRequestContext(headers=headers or {}, path=path, body=body)


# --- capabilities ------------------------------------------------------------- #


def test_capabilities_declare_no_backfill_and_html():
    caps = fetch_telegram_capabilities()
    assert caps.fill.backfill.supported is False
    assert caps.fill.forwardfill.supported is True
    assert caps.rendering.text.format == "html"
    assert caps.identity.keys["connection"] == ["bot_id"]


# --- signature ---------------------------------------------------------------- #


def test_verify_secret_passes_on_exact_match():
    verify_telegram_secret(
        headers={"x-telegram-bot-api-secret-token": WEBHOOK_SECRET},
        webhook_secret=WEBHOOK_SECRET,
    )


@pytest.mark.parametrize("header", [{}, {"x-telegram-bot-api-secret-token": "wrong"}])
def test_verify_secret_raises_on_missing_or_wrong(header):
    with pytest.raises(ChannelSignatureInvalid):
        verify_telegram_secret(headers=header, webhook_secret=WEBHOOK_SECRET)


# --- mapping ------------------------------------------------------------------ #


def test_routing_token_read_from_the_per_bot_path():
    assert routing_token_from_path("/telegram/events/4242/") == "4242"
    assert routing_token_from_path("/api/channels/telegram/events/99/") == "99"
    assert routing_token_from_path("/slack/events/") is None


def test_classify_space_kind():
    assert (
        classify_space_kind({"chat": {"type": "private"}}) == ChannelSpaceKind.PRIVATE
    )
    assert (
        classify_space_kind({"chat": {"type": "supergroup"}}) == ChannelSpaceKind.GROUP
    )
    assert (
        classify_space_kind(
            {"chat": {"type": "supergroup", "is_forum": True}, "message_thread_id": 7}
        )
        == ChannelSpaceKind.TOPIC
    )


def test_private_chat_is_always_addressed():
    assert (
        is_addressed(
            {"chat": {"type": "private"}, "text": "hi"},
            space_kind=ChannelSpaceKind.PRIVATE,
            bot_id=BOT_ID,
            bot_username=BOT_USERNAME,
        )
        is True
    )


def test_group_message_needs_mention_command_or_reply():
    plain = {"chat": {"type": "group"}, "text": "just chatting"}
    assert (
        is_addressed(
            plain,
            space_kind=ChannelSpaceKind.GROUP,
            bot_id=BOT_ID,
            bot_username=BOT_USERNAME,
        )
        is False
    )

    mention = {
        "chat": {"type": "group"},
        "text": f"@{BOT_USERNAME} help",
        "entities": [{"type": "mention", "offset": 0, "length": len(BOT_USERNAME) + 1}],
    }
    assert (
        is_addressed(
            mention,
            space_kind=ChannelSpaceKind.GROUP,
            bot_id=BOT_ID,
            bot_username=BOT_USERNAME,
        )
        is True
    )

    command = {
        "chat": {"type": "group"},
        "text": "/start",
        "entities": [{"type": "bot_command", "offset": 0, "length": 6}],
    }
    assert (
        is_addressed(
            command,
            space_kind=ChannelSpaceKind.GROUP,
            bot_id=BOT_ID,
            bot_username=BOT_USERNAME,
        )
        is True
    )

    reply = {
        "chat": {"type": "group"},
        "text": "yes",
        "reply_to_message": {"from": {"id": BOT_ID}},
    }
    assert (
        is_addressed(
            reply,
            space_kind=ChannelSpaceKind.GROUP,
            bot_id=BOT_ID,
            bot_username=BOT_USERNAME,
        )
        is True
    )


def test_to_html_escapes_specials():
    assert to_html("a < b & c > d") == "a &lt; b &amp; c &gt; d"


def test_render_content_buttons_become_inline_keyboard():
    content = [
        {"type": "text", "text": "Approve?"},
        {"type": "button", "label": "Approve", "value": "tok-approve"},
        {"type": "button", "label": "Deny", "value": "tok-deny"},
    ]
    text, markup = render_content(content)
    assert text == "Approve?"
    assert markup == {
        "inline_keyboard": [
            [{"text": "Approve", "callback_data": "tok-approve"}],
            [{"text": "Deny", "callback_data": "tok-deny"}],
        ]
    }


def test_render_content_degrades_over_button_max():
    content = [{"type": "text", "text": "Pick"}] + [
        {"type": "button", "label": f"Option {i}", "value": f"v{i}"} for i in range(9)
    ]
    text, markup = render_content(content)
    assert markup is None
    assert "1. Option 0" in text


def test_render_content_degrades_when_callback_too_long():
    content = [
        {"type": "button", "label": "Big", "value": "x" * 65},
    ]
    _text, markup = render_content(content)
    assert markup is None


# --- ingress: locator + signature -------------------------------------------- #


def test_connection_locator_reads_bot_id_from_path():
    adapter = TelegramAdapter()
    locator = adapter.connection_locator(request=_request(b"{}"))
    assert locator == {"bot_id": "4242"}


def test_connection_locator_none_off_a_non_telegram_path():
    adapter = TelegramAdapter()
    assert adapter.connection_locator(request=_request(b"{}", path="/")) is None


@pytest.mark.asyncio
async def test_verify_signature_returns_bot_id():
    adapter = TelegramAdapter()
    request = _request(
        b"{}", headers={"X-Telegram-Bot-Api-Secret-Token": WEBHOOK_SECRET}
    )
    assert await adapter.verify_signature(
        request=request, connection=_connection()
    ) == str(BOT_ID)


@pytest.mark.asyncio
async def test_verify_signature_raises_on_bad_secret():
    adapter = TelegramAdapter()
    request = _request(b"{}", headers={"X-Telegram-Bot-Api-Secret-Token": "nope"})
    with pytest.raises(ChannelSignatureInvalid):
        await adapter.verify_signature(request=request, connection=_connection())


# --- ingress: parse_event ----------------------------------------------------- #


@pytest.mark.asyncio
async def test_parse_event_message_in_a_dm():
    adapter = TelegramAdapter()
    body = json.dumps(
        {
            "update_id": 1,
            "message": {
                "message_id": 10,
                "from": {"id": 555, "is_bot": False},
                "chat": {"id": 999, "type": "private"},
                "text": "hello",
            },
        }
    ).encode()
    event = await adapter.parse_event(body=body, connection=_connection())
    assert event is not None
    assert event.kind == ChannelEventKind.MESSAGE
    assert event.space_kind == ChannelSpaceKind.PRIVATE
    assert event.external_locator == {"chat_id": 999}
    assert event.addressed is True
    assert event.processed.content == [{"type": "text", "text": "hello"}]


@pytest.mark.asyncio
async def test_parse_event_skips_the_bots_own_message():
    adapter = TelegramAdapter()
    body = json.dumps(
        {
            "message": {
                "message_id": 11,
                "from": {"id": BOT_ID, "is_bot": True},
                "chat": {"id": 999, "type": "private"},
                "text": "my own echo",
            }
        }
    ).encode()
    assert await adapter.parse_event(body=body, connection=_connection()) is None


@pytest.mark.asyncio
async def test_parse_event_callback_query_is_an_action():
    adapter = TelegramAdapter()
    body = json.dumps(
        {
            "callback_query": {
                "id": "cbq-1",
                "from": {"id": 555},
                "data": "tok-approve",
                "message": {
                    "message_id": 10,
                    "chat": {"id": 999, "type": "private"},
                },
            }
        }
    ).encode()
    event = await adapter.parse_event(body=body, connection=_connection())
    assert event is not None
    assert event.kind == ChannelEventKind.ACTION
    assert event.external_id == "cbq:cbq-1"
    assert event.processed.content == [{"type": "text", "text": "tok-approve"}]
    assert event.addressed is True


@pytest.mark.asyncio
async def test_parse_event_ignores_non_message_updates():
    adapter = TelegramAdapter()
    body = json.dumps({"update_id": 2, "edited_message": {"message_id": 1}}).encode()
    assert await adapter.parse_event(body=body, connection=_connection()) is None


@pytest.mark.asyncio
async def test_detect_deactivation_on_kick():
    adapter = TelegramAdapter()
    body = json.dumps(
        {"my_chat_member": {"new_chat_member": {"status": "kicked"}}}
    ).encode()
    assert await adapter.detect_deactivation(body=body) is True

    still_member = json.dumps(
        {"my_chat_member": {"new_chat_member": {"status": "member"}}}
    ).encode()
    assert await adapter.detect_deactivation(body=still_member) is False


# --- egress ------------------------------------------------------------------- #


def _adapter_with_capture():
    """A TelegramAdapter whose httpx client records requests and answers with a
    Bot API ok-shape echo."""

    seen = []

    def handler(request: httpx.Request) -> httpx.Response:
        seen.append(request)
        payload = json.loads(request.content.decode() or "{}")
        chat_id = payload.get("chat_id")
        return httpx.Response(
            200,
            json={
                "ok": True,
                "result": {
                    "message_id": 7777,
                    "chat": {"id": chat_id, "type": "private"},
                },
            },
        )

    client = httpx.AsyncClient(
        base_url="https://api.telegram.org", transport=httpx.MockTransport(handler)
    )
    return TelegramAdapter(http_client=client), seen


@pytest.mark.asyncio
async def test_post_message_sends_html_and_returns_locator():
    adapter, seen = _adapter_with_capture()
    receipt = await adapter.post_message(
        connection=_connection(),
        locator={"chat_id": 999},
        content=[{"type": "text", "text": "hi <there>"}],
        idempotency_key=uuid4(),
    )
    assert receipt == {"chat_id": 999, "message_id": 7777}
    # A real answer posts a message directly, with no typing action and no edit.
    assert [r.url.path for r in seen] == ["/bot123:abc/sendMessage"]
    body = json.loads(seen[0].content.decode())
    assert body["parse_mode"] == "HTML"
    assert body["text"] == "hi &lt;there&gt;"
    assert body["chat_id"] == 999


@pytest.mark.asyncio
async def test_indicator_content_shows_typing_and_posts_no_message():
    from oss.src.core.channels.render.render import INDICATOR_TEXT

    adapter, seen = _adapter_with_capture()
    receipt = await adapter.post_message(
        connection=_connection(),
        locator={"chat_id": 999},
        content=[{"type": "text", "text": INDICATOR_TEXT}],
        idempotency_key=uuid4(),
    )
    # The indicator becomes a typing action; no message is posted, and the
    # empty receipt tells the outbox to deliver the answer as a fresh message.
    assert receipt == {}
    assert [r.url.path for r in seen] == ["/bot123:abc/sendChatAction"]
    typing = json.loads(seen[0].content.decode())
    assert typing["action"] == "typing"
    assert typing["chat_id"] == 999


@pytest.mark.asyncio
async def test_edit_message_targets_editmessagetext():
    adapter, seen = _adapter_with_capture()
    receipt = await adapter.edit_message(
        connection=_connection(),
        external_locator={"chat_id": 999, "message_id": 7777},
        content=[{"type": "text", "text": "done"}],
        idempotency_key=uuid4(),
    )
    assert receipt == {"chat_id": 999, "message_id": 7777}
    assert seen[0].url.path == "/bot123:abc/editMessageText"
    body = json.loads(seen[0].content.decode())
    assert body["message_id"] == 7777


@pytest.mark.asyncio
async def test_activate_connection_registers_the_webhook(monkeypatch):
    from oss.src.utils.env import env

    monkeypatch.setattr(env.agenta, "api_url", "https://pub.example/api")
    adapter, seen = _adapter_with_capture()
    await adapter.activate_connection(
        connection=_connection(),
        credentials={"bot_token": "123:abc", "webhook_secret": WEBHOOK_SECRET},
    )
    assert seen[0].url.path == "/bot123:abc/setWebhook"
    body = json.loads(seen[0].content.decode())
    assert body["url"] == f"https://pub.example/api/channels/telegram/events/{BOT_ID}/"
    assert body["secret_token"] == WEBHOOK_SECRET
    assert "message" in body["allowed_updates"]
    assert "callback_query" in body["allowed_updates"]
