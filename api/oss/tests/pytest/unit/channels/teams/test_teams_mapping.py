from oss.src.core.channels.adapters.teams import mapping
from oss.src.core.channels.adapters.teams.capabilities import (
    fetch_teams_capabilities,
)
from oss.src.core.channels.commands import parse_command
from oss.src.core.channels.dtos import ChannelEventKind, ChannelSpaceKind

from . import payloads as p


def _parse(activity):
    return mapping.parse_activity(activity, app_id=p.APP_ID)


# --- ids ----------------------------------------------------------------- #


def test_every_app_id_form_turns_into_the_bare_id():
    for value in (
        p.APP_ID,
        f"28:{p.APP_ID}",
        f"api://{p.APP_ID}",
        f"api://botid-{p.APP_ID}",
        f"28:{p.APP_ID.upper()}",
    ):
        assert mapping.bare_app_id(value) == p.APP_ID


def test_an_empty_app_id_is_none():
    assert mapping.bare_app_id(None) is None
    assert mapping.bare_app_id("") is None
    assert mapping.bare_app_id("28:") is None


def test_a_thread_conversation_id_splits_and_joins_back():
    raw = "19:abc@thread.tacv2;messageid=111"

    conversation_id, thread_id = mapping.split_conversation_id(raw)

    assert (conversation_id, thread_id) == ("19:abc@thread.tacv2", "111")
    assert mapping.join_conversation_id(conversation_id, thread_id) == raw


def test_a_chat_conversation_id_has_no_thread():
    assert mapping.split_conversation_id(p.GROUP_CONVERSATION) == (
        p.GROUP_CONVERSATION,
        "",
    )
    assert mapping.join_conversation_id(p.GROUP_CONVERSATION, "") == (
        p.GROUP_CONVERSATION
    )


# --- places -------------------------------------------------------------- #


def test_personal_chat_is_a_private_space_with_no_thread():
    event = _parse(p.message(text="hi"))

    assert event.space_kind is ChannelSpaceKind.PRIVATE
    assert event.external_locator["conversation_id"] == p.PERSONAL_CONVERSATION
    assert event.external_locator["thread_id"] == ""


def test_group_chat_is_a_group_space_with_one_thread():
    event = _parse(
        p.message(
            text="<at>Helper</at> hi",
            conversation_type="groupChat",
            conversation_id=p.GROUP_CONVERSATION,
            entities=[p.bot_mention()],
        )
    )

    assert event.space_kind is ChannelSpaceKind.GROUP
    assert event.external_locator["thread_id"] == ""


def test_a_reply_in_a_channel_thread_keys_on_the_root():
    event = _parse(
        p.channel_message(
            text="<at>Helper</at> more", root="111", entities=[p.bot_mention()]
        )
    )

    assert event.space_kind is ChannelSpaceKind.TOPIC
    assert event.external_locator["conversation_id"] == p.CHANNEL_CONVERSATION
    assert event.external_locator["thread_id"] == "111"


def test_a_top_level_channel_post_is_the_root_of_its_own_thread():
    event = _parse(
        p.channel_message(
            text="<at>Helper</at> start", activity_id="222", entities=[p.bot_mention()]
        )
    )

    assert event.external_locator["conversation_id"] == p.CHANNEL_CONVERSATION
    assert event.external_locator["thread_id"] == "222"
    assert event.external_locator["title"] == "General"


def test_the_locator_keeps_the_service_url_and_the_message_id():
    event = _parse(p.message(text="hi", activity_id="1700000000777"))

    assert event.external_locator["service_url"] == p.SERVICE_URL
    assert event.external_locator["message_id"] == "1700000000777"
    assert event.external_locator["tenant_id"] == p.TENANT_ID
    assert event.external_id == f"{p.PERSONAL_CONVERSATION}:1700000000777"
    assert event.processed.message_ref == "1700000000777"
    assert event.processed.sent_at is not None


def test_an_unknown_conversation_type_is_ignored():
    assert _parse(p.message(conversation_type="meeting")) is None


# --- sender -------------------------------------------------------------- #


def test_the_sender_is_the_entra_object_id():
    event = _parse(p.message(text="hi"))

    assert event.processed.sender == {"id": p.USER_OBJECT_ID, "name": "Ada"}


def test_an_activity_without_an_object_id_is_ignored():
    activity = p.message(text="hi", sender={"id": "29:1abc", "name": "Ada"})

    assert _parse(activity) is None


# --- mentions ------------------------------------------------------------ #


def test_a_bot_mention_addresses_the_bot_and_leaves_the_text():
    event = _parse(
        p.channel_message(
            text="<at>Helper</at> what is the status?", entities=[p.bot_mention()]
        )
    )

    assert event.addressed is True
    assert event.processed.content == [{"type": "text", "text": "what is the status?"}]


def test_a_command_after_the_mention_parses():
    event = _parse(
        p.channel_message(text="<at>Helper</at> !new", entities=[p.bot_mention()])
    )

    assert event.processed.content[0]["text"] == "!new"
    command = parse_command(
        content=event.processed.content, capabilities=fetch_teams_capabilities()
    )
    assert command.command == "new"


def test_only_the_bot_mention_is_removed():
    other = {
        "type": "mention",
        "text": "<at>Grace</at>",
        "mentioned": {"id": "29:1grace", "name": "Grace"},
    }
    event = _parse(
        p.channel_message(
            text="<at>Helper</at> ask <at>Grace</at>",
            entities=[p.bot_mention(), other],
        )
    )

    assert event.processed.content[0]["text"] == "ask <at>Grace</at>"


def test_a_person_with_the_bot_name_keeps_their_mention():
    namesake = {
        "type": "mention",
        "text": "<at>Helper</at>",
        "mentioned": {"id": "29:1namesake", "name": "Helper"},
    }
    event = _parse(
        p.channel_message(
            text="<at>Helper</at> ask <at>Helper</at>",
            entities=[p.bot_mention(), namesake],
        )
    )

    assert event.processed.content[0]["text"] == "ask <at>Helper</at>"


def test_a_namesake_mentioned_before_the_bot_keeps_their_mention():
    namesake = {
        "type": "mention",
        "text": "<at>Helper</at>",
        "mentioned": {"id": "29:1namesake", "name": "Helper"},
    }
    event = _parse(
        p.channel_message(
            text="ask <at>Helper</at> for approval, <at>Helper</at>",
            entities=[namesake, p.bot_mention()],
        )
    )

    assert event.processed.content[0]["text"] == "ask <at>Helper</at> for approval,"


def test_one_activity_id_in_two_conversations_gives_two_keys():
    chat = _parse(p.message(text="hi", activity_id="1700000000777"))
    channel = _parse(
        p.channel_message(
            text="<at>Helper</at> hi",
            activity_id="1700000000777",
            entities=[p.bot_mention()],
        )
    )

    assert chat.external_id != channel.external_id


def test_a_tag_or_channel_mention_does_not_address_the_bot():
    tag = {
        "type": "mention",
        "text": "<at>Engineers</at>",
        "mentioned": {"id": "dGFnLWlk", "name": "Engineers", "type": "tag"},
    }
    channel = {
        "type": "mention",
        "text": "<at>General</at>",
        "mentioned": {"id": p.CHANNEL_CONVERSATION, "name": "General"},
    }
    event = _parse(
        p.channel_message(
            text="<at>Engineers</at> <at>General</at> hi", entities=[tag, channel]
        )
    )

    assert event.addressed is False


def test_the_bot_name_in_the_text_alone_does_not_address_the_bot():
    event = _parse(p.channel_message(text="<at>Helper</at> hi", entities=[]))

    assert event.addressed is False


def test_a_message_with_only_the_bot_mention_is_ignored():
    activity = p.channel_message(text="<at>Helper</at> ", entities=[p.bot_mention()])

    assert _parse(activity) is None


# --- card clicks --------------------------------------------------------- #


def test_a_card_click_is_an_action_with_the_choice_token():
    token = "5f0c6a8e-9d2b-4c1a-8e7f-3b2a1c0d9e8f:approve"

    event = _parse(p.card_click(token=token, card_id="1700000000555"))

    assert event.kind is ChannelEventKind.ACTION
    assert event.processed.content == [{"type": "text", "text": token}]
    assert event.external_locator["message_id"] == "1700000000555"
    conversation_id = event.external_locator["conversation_id"]
    assert event.external_id == f"{conversation_id}:1700000000556"
    assert event.addressed is True


def test_a_value_without_a_choice_token_or_text_is_ignored():
    activity = p.card_click(token="x")
    activity["value"] = {"other": "data"}

    assert _parse(activity) is None


def test_a_click_without_the_card_id_is_ignored():
    activity = p.card_click(token="x:approve")
    activity.pop("replyToId")

    assert _parse(activity) is None


# --- ignored activities -------------------------------------------------- #


def test_other_activity_types_are_ignored():
    for kind in (
        "installationUpdate",
        "conversationUpdate",
        "messageReaction",
        "messageUpdate",
        "messageDelete",
        "typing",
        "event",
        "invoke",
    ):
        assert _parse(p.message(text="hi", type=kind)) is None


def _channel_click(*, conversation_id, value_thread_id=None):
    activity = p.card_click(token="x:approve", card_id="333")
    activity["conversation"].update(
        {"id": conversation_id, "conversationType": "channel"}
    )
    if value_thread_id is not None:
        activity["value"]["thread_id"] = value_thread_id
    return activity


def test_a_click_takes_the_thread_from_the_conversation_id():
    event = _parse(
        _channel_click(
            conversation_id=f"{p.CHANNEL_CONVERSATION};messageid=111",
            value_thread_id="999",
        )
    )

    assert event.external_locator["conversation_id"] == p.CHANNEL_CONVERSATION
    assert event.external_locator["thread_id"] == "111"
    assert event.external_locator["message_id"] == "333"
    assert event.processed.message_ref == "333"


def test_a_click_without_a_thread_suffix_takes_the_thread_from_the_card_data():
    event = _parse(
        _channel_click(conversation_id=p.CHANNEL_CONVERSATION, value_thread_id="111")
    )

    assert event.external_locator["thread_id"] == "111"
    assert event.external_locator["message_id"] == "333"


def test_a_click_in_a_chat_has_no_thread_even_with_card_data():
    activity = p.card_click(token="x:approve", card_id="333")
    activity["value"]["thread_id"] = "111"

    assert _parse(activity).external_locator["thread_id"] == ""
