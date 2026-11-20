import re

from oss.src.core.channels.adapters.teams.capabilities import (
    GUID_PATTERN,
    fetch_teams_capabilities,
)
from oss.src.core.channels.dtos import ChannelKeyGrain
from oss.src.core.channels.utils import compose_external_key

from . import payloads as p


def test_the_declaration_survives_normalisation():
    capabilities = fetch_teams_capabilities()

    assert capabilities.channel == "teams"
    assert capabilities.addressing.mention is True
    assert capabilities.rendering.controls.indicator == "native"
    assert capabilities.rendering.controls.update is False
    assert capabilities.rendering.text.max_chars == 20000
    assert capabilities.fill.backfill.supported is False
    assert capabilities.rendering.files.send.supported is False
    assert capabilities.rendering.files.receive.supported is False
    assert capabilities.setup.instructions == []
    assert capabilities.commands == ["new", "sessions", "use"]


def test_the_three_setup_fields():
    fields = {f.name: f for f in fetch_teams_capabilities().setup.fields}

    assert fields["app_id"].label == "Application (client) ID"
    assert fields["tenant_id"].label == "Directory (tenant) ID"
    assert fields["client_secret"].label == "Client secret value"
    assert fields["client_secret"].secret is True
    assert fields["client_secret"].help == "Copy the secret's Value, not its Secret ID."
    for name in ("app_id", "tenant_id"):
        assert fields[name].secret is False
        assert fields[name].pattern_error == (
            "Enter the ID as a GUID, for example 00000000-0000-0000-0000-000000000000."
        )
    assert all(field.required for field in fields.values())


def test_the_guid_pattern():
    assert re.fullmatch(GUID_PATTERN, p.APP_ID)
    assert re.fullmatch(GUID_PATTERN, p.APP_ID.upper())
    assert not re.fullmatch(GUID_PATTERN, "not-a-guid")
    assert not re.fullmatch(GUID_PATTERN, f"28:{p.APP_ID}")


def test_chats_key_with_an_empty_thread_id():
    capabilities = fetch_teams_capabilities()
    chat = {"tenant_id": p.TENANT_ID, "conversation_id": p.GROUP_CONVERSATION}

    space = compose_external_key(capabilities, ChannelKeyGrain.SPACE, chat)
    thread = compose_external_key(
        capabilities, ChannelKeyGrain.THREAD, {**chat, "thread_id": ""}
    )

    assert space is not None and thread is not None
    assert space != thread


def test_service_url_and_message_id_are_not_part_of_any_key():
    capabilities = fetch_teams_capabilities()
    base = {
        "tenant_id": p.TENANT_ID,
        "conversation_id": p.CHANNEL_CONVERSATION,
        "thread_id": "111",
    }
    one = {**base, "service_url": p.SERVICE_URL, "message_id": "1"}
    two = {**base, "service_url": "https://elsewhere.example/", "message_id": "2"}

    for grain in (ChannelKeyGrain.SPACE, ChannelKeyGrain.THREAD):
        assert compose_external_key(capabilities, grain, one) == compose_external_key(
            capabilities, grain, two
        )
