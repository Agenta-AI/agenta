"""The Discord declaration after normalisation, and the keys it composes."""

from oss.src.core.channels.adapters.discord.capabilities import (
    fetch_discord_capabilities,
)
from oss.src.core.channels.adapters.discord.mapping import build_locator
from oss.src.core.channels.utils import ChannelKeyGrain, compose_external_key

from . import payloads as p


def test_the_declaration_has_the_v1_values():
    capabilities = fetch_discord_capabilities()

    assert capabilities.channel == "discord"
    assert capabilities.addressing.sigils.agent == "~"
    assert capabilities.addressing.sigils.command == "!"
    assert capabilities.addressing.commands.native is False
    assert capabilities.addressing.commands.in_conversation is True
    controls = capabilities.rendering.controls
    assert (controls.update, controls.ephemeral, controls.indicator) == (
        False,
        False,
        "native",
    )
    assert capabilities.rendering.buttons.max == 5
    assert capabilities.rendering.text.max_chars == 2000
    assert capabilities.rendering.files.send.supported is False
    assert capabilities.rendering.files.receive.supported is False
    assert capabilities.identity.keys == {
        ChannelKeyGrain.CONNECTION: ["application_id"],
        ChannelKeyGrain.SPACE: ["guild_id", "channel_id"],
        ChannelKeyGrain.THREAD: ["guild_id", "channel_id", "thread_id"],
    }
    [field] = capabilities.setup.fields
    assert (field.name, field.secret, field.required) == ("bot_token", True, True)
    assert capabilities.commands == ["new", "sessions", "use"]


def test_a_dm_composes_every_grain_with_an_empty_guild():
    capabilities = fetch_discord_capabilities()
    locator = build_locator(
        guild_id=None, source_channel_id=p.DM_CHANNEL_ID, message_id=p.MESSAGE_ID
    )

    assert locator["guild_id"] == ""
    assert compose_external_key(capabilities, ChannelKeyGrain.SPACE, locator)
    assert compose_external_key(capabilities, ChannelKeyGrain.THREAD, locator)


def test_two_mentions_in_one_channel_share_a_space_but_not_a_thread():
    capabilities = fetch_discord_capabilities()
    first, second = (
        build_locator(
            guild_id=p.GUILD_ID, source_channel_id=p.CHANNEL_ID, message_id=message_id
        )
        for message_id in ("1", "2")
    )

    def key(grain, locator):
        return compose_external_key(capabilities, grain, locator)

    assert key(ChannelKeyGrain.SPACE, first) == key(ChannelKeyGrain.SPACE, second)
    assert key(ChannelKeyGrain.THREAD, first) != key(ChannelKeyGrain.THREAD, second)


def test_a_message_in_the_thread_keys_to_the_opening_mention():
    capabilities = fetch_discord_capabilities()
    opening = build_locator(
        guild_id=p.GUILD_ID, source_channel_id=p.CHANNEL_ID, message_id=p.THREAD_ID
    )
    follow_up = build_locator(
        guild_id=p.GUILD_ID,
        source_channel_id=p.THREAD_ID,
        message_id="1200000000000000077",
        parent_id=p.CHANNEL_ID,
    )

    for grain in (ChannelKeyGrain.SPACE, ChannelKeyGrain.THREAD):
        assert compose_external_key(
            capabilities, grain, opening
        ) == compose_external_key(capabilities, grain, follow_up)


def test_the_connection_key_is_the_application_id():
    capabilities = fetch_discord_capabilities()

    assert compose_external_key(
        capabilities, ChannelKeyGrain.CONNECTION, {"application_id": p.APPLICATION_ID}
    ) != compose_external_key(
        capabilities, ChannelKeyGrain.CONNECTION, {"application_id": "other"}
    )


def test_the_application_name_is_the_default_connection_name():
    from oss.src.core.channels.dtos import ChannelConnectionCreate
    from oss.src.core.channels.service import _fill_connection_name_and_slug

    connection = ChannelConnectionCreate(channel="discord")
    _fill_connection_name_and_slug(
        connection, discovered={"application_name": p.APPLICATION_NAME}
    )

    assert connection.name == p.APPLICATION_NAME
