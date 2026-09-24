from oss.src.core.channels.adapters.slack.mapping import (
    build_locator,
    classify_space_kind,
    extract_sigils,
    is_bot_authored,
    parse_block_action,
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


def test_a_nested_edited_message_carries_its_authorship_one_level_down():
    """`message_changed` puts the authored message in `event["message"]` and
    leaves the outer event authorless. Reading only the outer event made our
    own "Working…" -> answer edit look like human input, which is how the
    bot-echo cascade started."""

    event = {"subtype": "message_changed", "message": {"bot_id": "B123"}}

    assert is_bot_authored(event, bot_user_id=None) is True


def test_a_nested_message_from_our_own_bot_user_id_is_bot_authored():
    event = {"subtype": "message_changed", "message": {"user": "U999"}}

    assert is_bot_authored(event, bot_user_id="U999") is True


def test_a_nested_message_from_a_human_is_still_not_bot_authored():
    event = {"subtype": "message_changed", "message": {"user": "U1"}}

    assert is_bot_authored(event, bot_user_id="U999") is False


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


# --- block_actions parsing --------------------------------------------------- #


def _block_actions_payload(**overrides):
    payload = {
        "type": "block_actions",
        "team": {"id": "T1"},
        "user": {"id": "U1"},
        "container": {"channel_id": "C1", "message_ts": "1000.1"},
        "message": {"thread_ts": "1000.1"},
        "actions": [
            {
                "action_id": "approve_button",
                "block_id": "b1",
                "value": "approve",
                "type": "button",
                "action_ts": "1700000000.000100",
            }
        ],
    }
    payload.update(overrides)
    return payload


def test_parse_block_action_extracts_token_and_locator_from_container():
    token, external_id, locator, user_id = parse_block_action(_block_actions_payload())

    assert token == "approve"
    assert locator == {"team": "T1", "channel": "C1", "thread_ts": "1000.1"}
    assert user_id == "U1"


def test_parse_block_action_external_id_is_the_actions_own_identity():
    """Not the message's ts -- every button on the same message would
    otherwise share one id and dedup into a single row."""

    _, external_id_1, _, _ = parse_block_action(_block_actions_payload())
    _, external_id_2, _, _ = parse_block_action(
        _block_actions_payload(
            actions=[
                {
                    "action_id": "deny_button",
                    "value": "deny",
                    "type": "button",
                    "action_ts": "1700000000.000200",
                }
            ]
        )
    )

    assert external_id_1 != external_id_2
    assert "1000.1" not in external_id_1  # the message's own ts, not this


def test_parse_block_action_redelivery_of_the_same_click_reuses_the_same_id():
    _, first, _, _ = parse_block_action(_block_actions_payload())
    _, second, _, _ = parse_block_action(_block_actions_payload())

    assert first == second


def test_parse_block_action_missing_value_returns_none():
    payload = _block_actions_payload(
        actions=[{"action_id": "approve_button", "type": "button"}]
    )
    assert parse_block_action(payload) is None


def test_parse_block_action_no_actions_returns_none():
    assert parse_block_action(_block_actions_payload(actions=[])) is None
