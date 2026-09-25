"""The pure half of the WhatsApp adapter: webhook parsing, the signature,
the verify token, and building `/messages` bodies. Every webhook fixture is
Meta-shaped (see payloads.py)."""

import pytest
from oss.src.core.channels.adapters.whatsapp import mapping
from oss.src.core.channels.adapters.whatsapp.capabilities import (
    fetch_whatsapp_capabilities,
)
from oss.src.core.channels.dtos import ChannelEventKind, ChannelSpaceKind
from oss.src.core.channels.render.render import render_turn_result
from oss.src.core.channels.types import ChannelSignatureInvalid

from . import payloads as p

# --- parsing ------------------------------------------------------------- #


def test_text_message_is_one_private_addressed_message():
    raw = p.encode(p.text_body("Where is my order?", message_id="wamid.A"))

    [event] = mapping.parse_events(body=raw, phone_number_id=p.PHONE_NUMBER_ID)

    assert event.kind is ChannelEventKind.MESSAGE
    assert event.space_kind is ChannelSpaceKind.PRIVATE
    assert event.addressed is True
    assert event.external_id == "wamid.A"
    assert event.external_locator == {"wa_id": p.CUSTOMER}
    assert event.processed.content == [{"type": "text", "text": "Where is my order?"}]
    assert event.processed.sender == {"id": p.CUSTOMER, "name": "Kerry Fisher"}
    # Meta's own timestamp, which the 24-hour window counts from
    assert event.processed.sent_at.timestamp() == 1758700000
    assert event.processed.message_ref == "wamid.A"


def test_button_and_list_replies_are_actions_carrying_the_token():
    raw = p.encode(
        p.body(
            p.value(
                messages=[
                    p.button_reply("row-1:approve"),
                    p.list_reply("row-2:opt4"),
                ]
            )
        )
    )

    tap, pick = mapping.parse_events(body=raw, phone_number_id=p.PHONE_NUMBER_ID)

    assert tap.kind is ChannelEventKind.ACTION
    assert tap.processed.content == [{"type": "text", "text": "row-1:approve"}]
    assert tap.external_id == "wamid.tap1"
    assert pick.kind is ChannelEventKind.ACTION
    assert pick.processed.content == [{"type": "text", "text": "row-2:opt4"}]


def test_a_multi_entry_body_splits_into_one_event_per_message_per_number():
    raw = p.encode(
        p.body(
            p.value(
                messages=[
                    p.text_message("one", message_id="wamid.1"),
                    p.text_message("two", message_id="wamid.2"),
                ]
            ),
            p.value(
                phone_number_id=p.OTHER_PHONE_NUMBER_ID,
                messages=[p.text_message("three", message_id="wamid.3")],
            ),
            entries=2,
        )
    )

    assert mapping.phone_number_ids(raw) == [
        p.PHONE_NUMBER_ID,
        p.OTHER_PHONE_NUMBER_ID,
    ]
    ours = mapping.parse_events(body=raw, phone_number_id=p.PHONE_NUMBER_ID)
    theirs = mapping.parse_events(body=raw, phone_number_id=p.OTHER_PHONE_NUMBER_ID)
    assert [e.external_id for e in ours] == ["wamid.1", "wamid.2"]
    assert [e.external_id for e in theirs] == ["wamid.3"]


def test_statuses_route_nothing_and_failed_ones_are_reported():
    raw = p.encode(
        p.body(p.value(statuses=[p.delivered_status(), p.failed_status(code=131047)]))
    )

    assert mapping.parse_events(body=raw, phone_number_id=p.PHONE_NUMBER_ID) == []
    assert mapping.failed_statuses(raw) == [
        {"message_id": "wamid.out.1", "code": 131047, "title": "Re-engagement message"}
    ]


def test_image_and_document_become_a_media_part_after_the_caption():
    raw = p.encode(
        p.body(
            p.value(
                messages=[
                    p.media_message(
                        "image",
                        media_id="IMG1",
                        mime_type="image/jpeg",
                        caption="This arrived damaged",
                        message_id="wamid.img",
                    ),
                    p.media_message(
                        "document",
                        media_id="DOC1",
                        filename="invoice.pdf",
                        message_id="wamid.doc",
                    ),
                ]
            )
        )
    )

    image, document = mapping.parse_events(body=raw, phone_number_id=p.PHONE_NUMBER_ID)

    assert image.processed.content == [
        {"type": "text", "text": "This arrived damaged"},
        {
            "type": "media",
            "kind": "image",
            "media_id": "IMG1",
            "mime_type": "image/jpeg",
            "filename": None,
        },
    ]
    assert document.processed.content == [
        {
            "type": "media",
            "kind": "document",
            "media_id": "DOC1",
            "mime_type": "application/pdf",
            "filename": "invoice.pdf",
        }
    ]


@pytest.mark.parametrize("kind", ["audio", "video"])
def test_voice_notes_and_video_become_media_parts(kind):
    raw = p.encode(
        p.body(
            p.value(
                messages=[p.media_message(kind, media_id="AV1", mime_type="audio/ogg")]
            )
        )
    )

    [event] = mapping.parse_events(body=raw, phone_number_id=p.PHONE_NUMBER_ID)

    [part] = event.processed.content
    assert part["type"] == "media"
    assert part["kind"] == kind
    assert part["media_id"] == "AV1"


def test_stickers_are_marked_unsupported():
    raw = p.encode(p.body(p.value(messages=[p.media_message("sticker")])))

    [event] = mapping.parse_events(body=raw, phone_number_id=p.PHONE_NUMBER_ID)

    [part] = event.processed.content
    assert part["unsupported"] is True


def test_reactions_and_group_messages_are_dropped():
    reaction = {
        "from": p.CUSTOMER,
        "id": "wamid.r",
        "type": "reaction",
        "reaction": {"message_id": "wamid.out.1", "emoji": "👍"},
    }
    group = {**p.text_message("hello group", message_id="wamid.g"), "group_id": "G1"}
    raw = p.encode(p.body(p.value(messages=[reaction, group])))

    assert mapping.parse_events(body=raw, phone_number_id=p.PHONE_NUMBER_ID) == []


@pytest.mark.parametrize(
    "raw",
    [
        b"not json",
        b'{"entry": 5}',
        b'{"entry": [{"changes": 5}]}',
        b'{"entry": [{"changes": [{"field": "messages", "value": {"metadata": "x"}}]}]}',
        b'{"entry": [{"changes": [{"field": "messages", "value": {"messages": 7}}]}]}',
    ],
)
def test_malformed_bodies_name_no_number_and_raise_nothing(raw):
    """Read before the signature check, so any caller controls it."""

    assert mapping.phone_number_ids(raw) == []
    assert mapping.parse_events(body=raw, phone_number_id=p.PHONE_NUMBER_ID) == []
    assert mapping.failed_statuses(raw) == []


def test_garbage_bodies_parse_to_nothing():
    assert mapping.phone_number_ids(b"not json") == []
    assert mapping.parse_events(body=b"[]", phone_number_id=p.PHONE_NUMBER_ID) == []


# --- signature ----------------------------------------------------------- #


def test_signature_over_the_raw_body_with_the_app_secret_passes():
    raw = p.encode(p.text_body())
    mapping.verify_signature(
        headers={"x-hub-signature-256": p.sign(raw)}, body=raw, app_secret=p.APP_SECRET
    )


@pytest.mark.parametrize(
    "headers",
    [
        {},
        {"x-hub-signature-256": ""},
        {"x-hub-signature-256": "sha256=deadbeef"},
        {"x-hub-signature-256": "sha1=abc"},
    ],
)
def test_missing_or_forged_signature_is_refused(headers):
    raw = p.encode(p.text_body())
    with pytest.raises(ChannelSignatureInvalid):
        mapping.verify_signature(headers=headers, body=raw, app_secret=p.APP_SECRET)


def test_signature_made_with_another_secret_or_over_another_body_is_refused():
    raw = p.encode(p.text_body())
    with pytest.raises(ChannelSignatureInvalid):
        mapping.verify_signature(
            headers={"x-hub-signature-256": p.sign(raw, "other-secret")},
            body=raw,
            app_secret=p.APP_SECRET,
        )
    with pytest.raises(ChannelSignatureInvalid):
        mapping.verify_signature(
            headers={"x-hub-signature-256": p.sign(raw)},
            body=raw + b" ",
            app_secret=p.APP_SECRET,
        )


def test_signature_compare_is_constant_time(monkeypatch):
    calls = []
    real = mapping.hmac.compare_digest

    def spy(a, b):
        calls.append((a, b))
        return real(a, b)

    monkeypatch.setattr(mapping.hmac, "compare_digest", spy)
    raw = p.encode(p.text_body())
    mapping.verify_signature(
        headers={"x-hub-signature-256": p.sign(raw)}, body=raw, app_secret=p.APP_SECRET
    )
    assert len(calls) == 1


def test_non_ascii_signature_header_is_a_refusal_not_a_crash():
    raw = p.encode(p.text_body())
    with pytest.raises(ChannelSignatureInvalid):
        mapping.verify_signature(
            headers={"x-hub-signature-256": "sha256=é" * 3},
            body=raw,
            app_secret=p.APP_SECRET,
        )


# --- verify token -------------------------------------------------------- #


def test_verify_token_names_its_phone_number():
    token = mapping.mint_verify_token(p.PHONE_NUMBER_ID)
    assert mapping.phone_number_id_from_verify_token(token) == p.PHONE_NUMBER_ID
    assert token != mapping.mint_verify_token(p.PHONE_NUMBER_ID)


@pytest.mark.parametrize("token", ["", "nodot", "abc.def", ".x"])
def test_malformed_verify_token_names_no_number(token):
    assert mapping.phone_number_id_from_verify_token(token) is None


# --- outbound ------------------------------------------------------------ #


def test_markdown_becomes_whatsapp_marks():
    text = "# Order\n**Shipped** on *Monday*, see [tracking](https://t.co/x) ~~late~~"
    assert mapping.markdown_to_whatsapp(text) == (
        "*Order*\n*Shipped* on _Monday_, see tracking (https://t.co/x) ~late~"
    )


def test_code_fences_are_left_alone():
    text = "Run:\n```\na = **b**\n```\n**done**"
    assert mapping.markdown_to_whatsapp(text) == "Run:\n```\na = **b**\n```\n*done*"


def test_plain_text_is_one_text_message():
    [message] = mapping.build_messages(
        content=[{"type": "text", "text": "Yes, it left yesterday."}], wa_id=p.CUSTOMER
    )
    assert message == {
        "messaging_product": "whatsapp",
        "recipient_type": "individual",
        "to": p.CUSTOMER,
        "type": "text",
        "text": {"body": "Yes, it left yesterday.", "preview_url": False},
    }


def test_an_approval_renders_reply_buttons_with_the_redacted_request():
    capabilities = fetch_whatsapp_capabilities()
    [item] = render_turn_result(
        capabilities=capabilities,
        folded={
            "stop_reason": "paused",
            "pending_interaction": {
                "id": "i-1",
                "tool": "cancel_order",
                "payload": {
                    "toolCall": {"rawInput": {"order": "4411", "api_key": "k"}}
                },
            },
        },
    )
    content = [part.model_dump(exclude_none=True) for part in item.parts]

    [message] = mapping.build_messages(content=content, wa_id=p.CUSTOMER)

    interactive = message["interactive"]
    assert interactive["type"] == "button"
    assert [b["reply"] for b in interactive["action"]["buttons"]] == [
        {"id": "approve", "title": "Approve"},
        {"id": "deny", "title": "Deny"},
    ]
    body = interactive["body"]["text"]
    assert "Approval needed: Cancel order" in body
    assert "4411" in body
    assert "[REDACTED]" in body and '"k"' not in body


def _buttons(count):
    return [
        {
            "type": "button",
            "id": str(i),
            "label": f"Option number {i} is long",
            "value": f"t{i}",
        }
        for i in range(count)
    ]


def test_a_body_too_long_for_an_interactive_message_goes_first_as_text():
    """Nothing is cut: the customer sees the whole request before choosing."""

    lines = [f"argument line {i:03d} " + "x" * 40 for i in range(40)]  # ~2400 chars
    text = "\n".join(lines)

    *leading, interactive = mapping.build_messages(
        content=[{"type": "text", "text": text}, *_buttons(2)], wa_id=p.CUSTOMER
    )

    assert [m["type"] for m in leading] == ["text"]
    body = interactive["interactive"]["body"]["text"]
    assert len(body) <= mapping.INTERACTIVE_BODY_MAX_CHARS
    shown = leading[0]["text"]["body"] + "\n" + body
    assert shown == text


def test_four_to_ten_options_render_as_a_list():
    [message] = mapping.build_messages(
        content=[{"type": "text", "text": "Pick one"}, *_buttons(5)], wa_id=p.CUSTOMER
    )
    interactive = message["interactive"]
    assert interactive["type"] == "list"
    rows = interactive["action"]["sections"][0]["rows"]
    assert [row["id"] for row in rows] == ["t0", "t1", "t2", "t3", "t4"]
    assert all(len(row["title"]) <= 24 for row in rows)


def test_button_titles_are_clipped_to_twenty_characters():
    [message] = mapping.build_messages(content=_buttons(2), wa_id=p.CUSTOMER)
    titles = [b["reply"]["title"] for b in message["interactive"]["action"]["buttons"]]
    assert all(len(title) <= 20 for title in titles)


def test_more_than_ten_options_come_from_core_as_numbered_text():
    capabilities = fetch_whatsapp_capabilities()
    assert capabilities.rendering.buttons.max == 10


def test_long_answers_split_at_4096_on_boundaries():
    capabilities = fetch_whatsapp_capabilities()
    paragraph = ("word " * 199).strip() + "."  # ~1000 characters
    text = "\n\n".join([paragraph] * 9)  # ~9000 characters

    items = render_turn_result(
        capabilities=capabilities,
        folded={"messages": [{"role": "assistant", "content": text}]},
    )

    assert len(items) == 3
    for item in items:
        [part] = item.parts
        assert len(part.text) <= 4096
        assert not part.text.endswith("wor")  # never cut mid-word
    assert "".join(i.parts[0].text for i in items).replace("\n", "") == text.replace(
        "\n", ""
    )


def test_oversize_text_reaching_the_adapter_is_split_not_truncated():
    messages = mapping.build_messages(
        content=[{"type": "text", "text": "x" * 5000}], wa_id=p.CUSTOMER
    )
    assert [len(m["text"]["body"]) for m in messages] == [4096, 904]
