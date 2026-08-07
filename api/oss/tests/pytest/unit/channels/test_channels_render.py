"""render module: fold-result -> capability-degraded vocabulary. Pure, no DB."""

from oss.src.core.channels.dtos import ChannelCapabilities
from oss.src.core.channels.render.render import render_indicator, render_turn_result


BUTTONS_OK = ChannelCapabilities(
    channel="fake",
    rendering={
        "controls": {"update": True},
        "buttons": {"supported": True, "max": 5},
        "text": {"format": "markdown", "max_chars": 3000},
    },
)

NO_BUTTONS = ChannelCapabilities(
    channel="fake",
    rendering={
        "controls": {"update": True},
        "buttons": {"supported": False, "max": 0},
        "text": {"format": "markdown", "max_chars": 3000},
    },
)

TIGHT_BUTTONS = ChannelCapabilities(
    channel="fake",
    rendering={
        "controls": {"update": True},
        "buttons": {"supported": True, "max": 1},
        "text": {"format": "markdown", "max_chars": 3000},
    },
)

TINY_TEXT = ChannelCapabilities(
    channel="fake",
    rendering={
        "controls": {"update": True},
        "buttons": {"supported": True, "max": 5},
        "text": {"format": "plain", "max_chars": 10},
    },
)

NO_EDIT = ChannelCapabilities(
    channel="fake",
    rendering={
        "controls": {"update": False},
        "buttons": {"supported": True, "max": 5},
        "text": {"format": "plain", "max_chars": 3000},
    },
)


def _folded(text: str, stop_reason: str = "ended"):
    return {
        "messages": [{"role": "assistant", "content": text}],
        "stop_reason": stop_reason,
        "pending_interaction": None,
    }


def test_indicator_is_one_text_part():
    item = render_indicator(capabilities=BUTTONS_OK)

    assert len(item.parts) == 1
    assert item.parts[0].type == "text"
    assert item.parts[0].text


def test_answer_renders_as_single_text_item_under_the_limit():
    items = render_turn_result(capabilities=BUTTONS_OK, folded=_folded("hello there"))

    assert len(items) == 1
    assert len(items[0].parts) == 1
    assert items[0].parts[0].type == "text"
    assert items[0].parts[0].text == "hello there"


def test_answer_over_max_chars_splits_into_multiple_items():
    text = "x" * 25  # TINY_TEXT max_chars=10 -> 3 chunks
    items = render_turn_result(capabilities=TINY_TEXT, folded=_folded(text))

    assert len(items) == 3
    assert all(len(item.parts) == 1 for item in items)
    assert "".join(item.parts[0].text for item in items) == text
    assert all(len(item.parts[0].text) <= 10 for item in items)


def test_pending_interaction_renders_as_card_with_buttons_when_supported():
    folded = {
        "messages": [],
        "stop_reason": "paused",
        "pending_interaction": {
            "id": "int-1",
            "tool": "delete_file",
            "payload": {
                "toolCall": {"name": "delete_file", "arguments": {"path": "/x"}}
            },
        },
    }

    items = render_turn_result(capabilities=BUTTONS_OK, folded=folded)

    assert len(items) == 1
    parts = items[0].parts
    assert parts[0].type == "card"
    assert parts[0].tool == "delete_file"
    assert parts[0].arguments == {"path": "/x"}
    button_parts = [p for p in parts if p.type == "button"]
    assert len(button_parts) == 2
    assert {p.value for p in button_parts} == {"approve", "deny"}


def test_pending_interaction_degrades_to_numbered_text_when_buttons_unsupported():
    folded = {
        "messages": [],
        "stop_reason": "paused",
        "pending_interaction": {
            "id": "int-1",
            "tool": "delete_file",
            "payload": {"toolCall": {"name": "delete_file"}},
        },
    }

    items = render_turn_result(capabilities=NO_BUTTONS, folded=folded)

    assert len(items) == 1
    assert len(items[0].parts) == 1
    part = items[0].parts[0]
    assert part.type == "text"
    assert "1. Approve" in part.text
    assert "2. Deny" in part.text


def test_pending_interaction_degrades_to_numbered_text_when_option_count_exceeds_max():
    folded = {
        "messages": [],
        "stop_reason": "paused",
        "pending_interaction": {"id": "int-1", "tool": "t", "payload": {}},
    }

    # two options (approve/deny), buttons.max == 1 -> exceeds the ceiling
    items = render_turn_result(capabilities=TIGHT_BUTTONS, folded=folded)

    assert len(items) == 1
    assert items[0].parts[0].type == "text"
    assert "1. Approve" in items[0].parts[0].text


def test_no_raw_thought_or_usage_event_ever_appears_in_rendered_output():
    folded = {
        "messages": [
            {"role": "assistant", "content": "the answer"},
        ],
        "stop_reason": "ended",
        "pending_interaction": None,
    }
    # a fixture that also carried a thought/usage event upstream would never
    # reach here — fold() already drops them (fold.py) — assert the render
    # module does not itself leak anything beyond the message text.
    items = render_turn_result(capabilities=BUTTONS_OK, folded=folded)

    rendered_text = " ".join(part.text or "" for item in items for part in item.parts)
    assert rendered_text == "the answer"
    assert "thought" not in rendered_text.lower()
    assert "usage" not in rendered_text.lower()


def test_no_raw_acp_payload_string_appears_verbatim():
    folded = {
        "messages": [],
        "stop_reason": "paused",
        "pending_interaction": {
            "id": "int-1",
            "tool": "delete_file",
            "payload": {
                "toolCall": {"name": "delete_file", "arguments": {"path": "/x"}},
                "raw_acp_envelope": "SECRET_INTERNAL_PAYLOAD_MARKER",
            },
        },
    }

    items = render_turn_result(capabilities=BUTTONS_OK, folded=folded)

    dumped = [
        part.model_dump(exclude_none=True) for item in items for part in item.parts
    ]
    assert "SECRET_INTERNAL_PAYLOAD_MARKER" not in str(dumped)


def test_edit_capability_flag_is_read_from_controls_update():
    # render module does not itself gate on controls.update (that is the
    # worker's job when choosing post vs edit) — this asserts the capability
    # value the worker reads is exactly what was declared.
    assert NO_EDIT.rendering.controls.update is False
    assert BUTTONS_OK.rendering.controls.update is True
