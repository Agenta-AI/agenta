from oss.src.core.channels.adapters.slack.mapping import (
    build_locator,
    classify_space_kind,
    extract_sigils,
    is_bot_authored,
    render_approval_card,
    render_buttons_or_degrade,
    split_for_max_chars,
)
from oss.src.core.channels.dtos import ChannelSpaceKind


# --- sigil tokenisation ---------------------------------------------------- #


def test_agent_sigil_extracted_alongside_rewritten_mention_token():
    text = "<@U0123ABC> ~support please help !new"
    agent, command, arg = extract_sigils(text)

    assert agent == "support"
    assert command == "new"
    assert arg is None


def test_command_with_argument_is_extracted():
    agent, command, arg = extract_sigils("!use:gpt-5")

    assert command == "use"
    assert arg == "gpt-5"


def test_neither_sigil_present_returns_all_none():
    agent, command, arg = extract_sigils("just a normal message")

    assert agent is None
    assert command is None
    assert arg is None


# --- space-kind classification ---------------------------------------------- #


def test_im_classifies_private():
    assert classify_space_kind({"channel_type": "im"}) == ChannelSpaceKind.PRIVATE
    assert classify_space_kind({"is_im": True}) == ChannelSpaceKind.PRIVATE


def test_mpim_classifies_group():
    assert classify_space_kind({"channel_type": "mpim"}) == ChannelSpaceKind.GROUP
    assert classify_space_kind({"is_mpim": True}) == ChannelSpaceKind.GROUP


def test_private_channel_classifies_topic():
    assert classify_space_kind({"channel_type": "group"}) == ChannelSpaceKind.TOPIC


def test_public_channel_classifies_topic():
    assert classify_space_kind({"channel_type": "channel"}) == ChannelSpaceKind.TOPIC


# --- locator / thread-unit recognition -------------------------------------- #


def test_thread_ts_present_produces_thread_locator():
    locator = build_locator(team="T1", channel="C1", thread_ts="1000.1")

    assert locator == {"team": "T1", "channel": "C1", "thread_ts": "1000.1"}


def test_no_thread_ts_produces_space_locator():
    locator = build_locator(team="T1", channel="C1")

    assert locator == {"team": "T1", "channel": "C1"}
    assert "thread_ts" not in locator


def test_two_distinct_threads_produce_distinct_locators():
    a = build_locator(team="T1", channel="C1", thread_ts="1000.1")
    b = build_locator(team="T1", channel="C1", thread_ts="2000.2")

    assert a != b


# --- bot-authored marking ---------------------------------------------------- #


def test_message_with_bot_id_is_bot_authored():
    assert is_bot_authored({"bot_id": "B123"}, bot_user_id=None) is True


def test_message_from_own_bot_user_id_is_bot_authored():
    assert is_bot_authored({"user": "U999"}, bot_user_id="U999") is True


def test_message_from_a_human_is_not_bot_authored():
    assert is_bot_authored({"user": "U1"}, bot_user_id="U999") is False


# --- outbound: splitting, button degradation, approval cards --------------- #


def test_content_under_max_chars_is_not_split():
    text = "hello"
    assert split_for_max_chars(text, max_chars=4000) == [text]


def test_content_over_max_chars_splits_rather_than_truncates():
    text = "x" * 4001
    parts = split_for_max_chars(text, max_chars=4000)

    assert len(parts) == 2
    assert "".join(parts) == text  # nothing lost
    assert len(parts[0]) == 4000


def test_options_within_buttons_max_render_as_buttons():
    options = [{"label": f"opt{i}", "value": str(i)} for i in range(3)]
    rendered = render_buttons_or_degrade(options, buttons_max=5)

    assert rendered["type"] == "buttons"
    assert len(rendered["elements"]) == 3


def test_options_over_buttons_max_degrade_to_numbered_text():
    options = [{"label": f"opt{i}", "value": str(i)} for i in range(6)]
    rendered = render_buttons_or_degrade(options, buttons_max=5)

    assert rendered["type"] == "text"
    assert "1. opt0" in rendered["text"]
    assert "6. opt5" in rendered["text"]


def test_approval_card_sources_only_the_recorded_tool_call():
    tool_call = {"name": "delete_file", "arguments": {"path": "/tmp/x"}}
    card = render_approval_card(tool_call)

    assert "delete_file" in card["text"]
    assert "/tmp/x" in card["text"]
