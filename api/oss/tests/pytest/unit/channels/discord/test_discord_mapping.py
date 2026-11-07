"""Pure Discord mapping: locators, echoes, mentions, splitting and buttons."""

from oss.src.core.channels.adapters.discord import mapping
from oss.src.core.channels.dtos import ChannelEventKind, ChannelSpaceKind
from oss.src.core.channels.render.render import _split_text

from . import payloads as p


def _parse(payload, *, parent_id=None):
    data = payload["d"]
    return mapping.parse_message(
        data,
        guild_id=data.get("guild_id"),
        parent_id=parent_id,
        bot_user_id=p.BOT_USER_ID,
        bot_username=p.BOT_USERNAME,
    )


# --- locators ------------------------------------------------------------ #


def test_a_dm_has_no_guild_and_no_thread():
    event = _parse(p.dm())

    assert event.space_kind is ChannelSpaceKind.PRIVATE
    assert event.external_locator == {
        "guild_id": "",
        "channel_id": p.DM_CHANNEL_ID,
        "thread_id": "",
        "source_channel_id": p.DM_CHANNEL_ID,
        "message_id": p.MESSAGE_ID,
    }


def test_a_mention_points_at_the_thread_its_reply_opens():
    event = _parse(p.mention("where is my order?"))

    assert event.space_kind is ChannelSpaceKind.TOPIC
    assert event.addressed is True
    assert event.external_locator == {
        "guild_id": p.GUILD_ID,
        "channel_id": p.CHANNEL_ID,
        "thread_id": p.MESSAGE_ID,
        "source_channel_id": p.CHANNEL_ID,
        "message_id": p.MESSAGE_ID,
        "thread_name": f"@{p.BOT_USERNAME} where is my order?",
    }
    assert mapping.reply_channel_id(event.external_locator) == p.MESSAGE_ID
    assert mapping.opens_thread(event.external_locator)


def test_a_message_in_a_thread_names_the_parent_channel():
    event = _parse(
        p.in_thread("and the second one?", message_id="1200000000000000077"),
        parent_id=p.CHANNEL_ID,
    )

    assert event.external_locator == {
        "guild_id": p.GUILD_ID,
        "channel_id": p.CHANNEL_ID,
        "thread_id": p.THREAD_ID,
        "source_channel_id": p.THREAD_ID,
        "message_id": "1200000000000000077",
    }
    assert event.addressed is False
    assert not mapping.opens_thread(event.external_locator)


def test_ids_and_sender():
    event = _parse(p.mention())

    assert event.external_id == p.MESSAGE_ID
    assert event.kind is ChannelEventKind.MESSAGE
    assert event.processed.message_ref == p.MESSAGE_ID
    assert event.processed.sender == {
        "id": p.USER_ID,
        "name": "Kerry Fisher",
        "username": "kerry",
    }
    assert event.processed.sent_at.year == 2026


def test_the_bots_own_mention_reads_as_its_handle():
    event = _parse(p.mention("hello"))

    assert event.processed.content == [
        {"type": "text", "text": f"@{p.BOT_USERNAME} hello"}
    ]


# --- echoes and noise ---------------------------------------------------- #


def test_the_bots_own_message_is_dropped():
    assert _parse(p.message("answer", author=p.BOT_AUTHOR)) is None


def test_another_bots_message_is_dropped():
    other = {"id": "999", "username": "otherbot", "bot": True}
    assert _parse(p.message("hi", author=other)) is None


def test_a_system_notice_is_dropped():
    assert _parse(p.message("", message_type=18)) is None


def test_a_reply_is_a_message():
    assert _parse(p.message("yes", message_type=19)) is not None


def test_a_mention_of_someone_else_is_not_addressed():
    payload = p.message("hey <@555>")
    payload["d"]["mentions"] = [{"id": "555", "username": "kerry"}]

    assert _parse(payload).addressed is False


# --- clicks -------------------------------------------------------------- #


def test_a_click_in_a_thread_keys_to_that_thread():
    event = mapping.parse_interaction(p.click("int-1:approve")["d"])

    assert event.kind is ChannelEventKind.ACTION
    assert event.external_id == "1400000000000000001"
    assert event.processed.message_ref == "1300000000000000555"
    assert event.processed.content == [{"type": "text", "text": "int-1:approve"}]
    assert event.external_locator == {
        "guild_id": p.GUILD_ID,
        "channel_id": p.CHANNEL_ID,
        "thread_id": p.THREAD_ID,
        "source_channel_id": p.THREAD_ID,
        "message_id": "1300000000000000555",
    }


def test_a_click_in_a_dm():
    event = mapping.parse_interaction(
        p.click(
            "int-1:deny",
            channel={"id": p.DM_CHANNEL_ID, "type": 1},
            guild_id=None,
        )["d"]
    )

    assert event.space_kind is ChannelSpaceKind.PRIVATE
    assert event.external_locator["thread_id"] == ""
    assert event.processed.sender["id"] == p.USER_ID


def test_an_interaction_that_is_not_a_button_is_dropped():
    data = p.click("x")["d"]
    data["data"]["component_type"] = 3  # a select menu
    assert mapping.parse_interaction(data) is None


# --- splitting ----------------------------------------------------------- #


def test_a_long_answer_splits_into_three_messages():
    paragraph = ("word " * 179).strip() + "."
    chunks = _split_text("\n\n".join([paragraph] * 5), 2000)

    assert len(chunks) == 3
    assert all(len(chunk) <= 2000 for chunk in chunks)


def test_a_code_block_near_the_boundary_starts_a_new_message():
    # about 600 characters, with blank lines a plain split would cut at
    block = "```python\n" + ("x = 1\n" * 10 + "\n") * 9 + "```"
    text = ("word " * 300).strip() + "\n\n" + block + "\n\nafter"

    chunks = _split_text(text, 2000)

    assert block in chunks[1]
    assert "```" not in chunks[0]


def test_a_code_block_longer_than_one_message_closes_and_reopens_its_fence():
    block = "```\n" + "x = 1\n" * 500 + "```"
    chunks = _split_text("intro\n\n" + block, 2000)

    assert len(chunks) > 1
    assert all(len(chunk) <= 2000 for chunk in chunks)
    assert all(chunk.count("```") % 2 == 0 for chunk in chunks)


def test_oversize_content_is_still_cut_to_the_limit():
    bodies = mapping.build_messages([{"type": "text", "text": "a" * 4500}])

    assert [len(body["content"]) for body in bodies] == [2000, 2000, 500]
    assert all(body["allowed_mentions"] == {"parse": []} for body in bodies)


# --- buttons ------------------------------------------------------------- #


def _approval(token="int-1"):
    return [
        {"type": "card", "title": "Approval needed: Cancel order", "text": "once"},
        {"type": "button", "id": "0", "label": "Approve", "value": f"{token}:approve"},
        {"type": "button", "id": "1", "label": "Deny", "value": f"{token}:deny"},
    ]


def test_an_approval_becomes_one_action_row_of_buttons():
    [body] = mapping.build_messages(_approval())

    assert body["content"].startswith("Approval needed: Cancel order")
    [row] = body["components"]
    assert row["type"] == 1
    assert [(b["type"], b["label"], b["custom_id"]) for b in row["components"]] == [
        (2, "Approve", "int-1:approve"),
        (2, "Deny", "int-1:deny"),
    ]


def test_the_choice_token_of_a_real_interaction_fits_the_custom_id():
    token = "0193a3f0-6d3c-7b3e-9c1f-2a7e5d4b8c10"
    [body] = mapping.build_messages(_approval(token))

    ids = [b["custom_id"] for b in body["components"][0]["components"]]
    assert [len(i) for i in ids] == [44, 41]


def test_buttons_degrade_to_numbered_text_above_the_limit():
    content = [
        {"type": "button", "id": str(i), "label": f"Option {i}", "value": f"v{i}"}
        for i in range(6)
    ]
    [body] = mapping.build_messages(content)

    assert "components" not in body
    assert "6. Option 5" in body["content"]


def test_buttons_degrade_when_a_token_is_too_long():
    [body] = mapping.build_messages(
        [{"type": "button", "id": "0", "label": "Go", "value": "x" * 101}]
    )

    assert "components" not in body
    assert body["content"] == "1. Go"


def test_the_invite_url_has_the_exact_permissions():
    assert mapping.invite_url("123") == (
        "https://discord.com/oauth2/authorize"
        "?client_id=123&scope=bot&permissions=309237763136"
    )
