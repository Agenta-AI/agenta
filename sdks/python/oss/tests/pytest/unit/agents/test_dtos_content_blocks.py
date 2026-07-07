"""Content blocks and messages: loose-input coercion and wire serialization.

The playground sends loose dicts and bare strings; the runtime coerces them and emits
camelCase on the wire. These round-trips lock that coercion.
"""

from __future__ import annotations

from agenta.sdk.agents import ContentBlock, Message, to_messages


def test_content_block_from_string():
    block = ContentBlock.from_raw("hello")
    assert block.type == "text"
    assert block.text == "hello"


def test_content_block_from_dict_accepts_both_mime_spellings():
    camel = ContentBlock.from_raw(
        {"type": "image", "data": "b64", "mimeType": "image/png"}
    )
    snake = ContentBlock.from_raw(
        {"type": "image", "data": "b64", "mime_type": "image/png"}
    )
    assert camel.mime_type == "image/png"
    assert snake.mime_type == "image/png"


def test_content_block_passthrough_and_fallback():
    existing = ContentBlock(type="text", text="x")
    assert ContentBlock.from_raw(existing) is existing
    # A non-string, non-dict value stringifies into a text block.
    assert ContentBlock.from_raw(42).text == "42"


def test_content_block_to_wire_omits_none_and_uses_camelcase():
    block = ContentBlock(type="image", data="b64", mime_type="image/png")
    wire = block.to_wire()
    assert wire == {"type": "image", "data": "b64", "mimeType": "image/png"}
    assert "text" not in wire  # None fields are omitted


def test_text_block_round_trips():
    assert ContentBlock(type="text", text="hi").to_wire() == {
        "type": "text",
        "text": "hi",
    }


def test_message_from_raw_requires_role():
    assert Message.from_raw({"content": "no role"}) is None
    assert Message.from_raw("not a dict") is None
    msg = Message.from_raw({"role": "user", "content": "hi"})
    assert msg is not None and msg.role == "user" and msg.content == "hi"


def test_message_from_raw_coerces_block_list():
    msg = Message.from_raw(
        {"role": "user", "content": [{"type": "text", "text": "a"}, "b"]}
    )
    assert isinstance(msg.content, list)
    assert [b.text for b in msg.content] == ["a", "b"]


def test_message_to_wire_string_and_blocks():
    assert Message(role="user", content="hi").to_wire() == {
        "role": "user",
        "content": "hi",
    }
    blocks = Message(role="user", content=[ContentBlock(type="text", text="a")])
    assert blocks.to_wire() == {
        "role": "user",
        "content": [{"type": "text", "text": "a"}],
    }


def test_to_messages_filters_invalid_entries():
    messages = to_messages(
        [
            {"role": "user", "content": "hi"},
            {"content": "no role"},  # dropped
            None,  # dropped
            {"role": "assistant", "content": "yo"},
        ]
    )
    assert [m.role for m in messages] == ["user", "assistant"]


def test_to_messages_handles_none():
    assert to_messages(None) == []
