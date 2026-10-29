"""The hosted ingress update parsers. Pure functions over a Telegram update."""

from oss.src.apis.fastapi.channels.ingress import (
    _start_command_token,
    _update_chat_id,
    _update_sender_id,
    _update_text,
)


def test_start_command_token_extracts_the_deep_link_argument():
    assert _start_command_token("/start abc123") == "abc123"
    assert _start_command_token("/start@AgentaBot abc123") == "abc123"
    # a bare /start (no argument) is an ordinary open, not a bind
    assert _start_command_token("/start") is None
    assert _start_command_token("hello") is None
    assert _start_command_token("") is None


def test_update_extractors_read_a_message():
    update = {
        "message": {
            "chat": {"id": -4242, "type": "private"},
            "from": {"id": 777},
            "text": "hi there",
        }
    }
    assert _update_chat_id(update) == -4242
    assert _update_sender_id(update) == 777
    assert _update_text(update) == "hi there"


def test_update_extractors_read_a_callback_query():
    update = {
        "callback_query": {
            "id": "cbq1",
            "from": {"id": 888},
            "message": {"chat": {"id": -99, "type": "group"}},
            "data": "approve:abc",
        }
    }
    # a callback has no text, but the chat and sender still resolve
    assert _update_chat_id(update) == -99
    assert _update_sender_id(update) == 888
    assert _update_text(update) == ""


def test_start_command_token_on_whitespace_only_is_none_not_a_crash():
    from oss.src.apis.fastapi.channels.ingress import _start_command_token

    # previously these indexed an empty split and raised IndexError
    assert _start_command_token("   ") is None
    assert _start_command_token("\n\t") is None


def test_update_chat_type_reads_private_vs_group():
    from oss.src.apis.fastapi.channels.ingress import _update_chat_type

    assert (
        _update_chat_type({"message": {"chat": {"id": 1, "type": "private"}}})
        == "private"
    )
    assert (
        _update_chat_type({"message": {"chat": {"id": -9, "type": "supergroup"}}})
        == "supergroup"
    )
