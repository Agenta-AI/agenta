from uuid import UUID

from oss.src.core.channels.adapters.bridge.envelope import (
    build_delivery_command,
    parse_inbound_envelope,
    parse_receipt,
)
from oss.src.core.channels.dtos import ChannelSpaceKind
from oss.src.core.channels.utils import compose_external_key
from oss.src.core.channels.dtos import ChannelCapabilities, ChannelKeyGrain

WORKED_INBOUND = {
    "specversion": "1.0",
    "id": "wecom-msg-98234",
    "type": "io.agenta.channel.message.received.v1",
    "source": "bridge/acme-wecom",
    "time": "2026-07-20T10:00:00Z",
    "data": {
        "space": {"locator": {"chat_id": "grp_456"}, "type": "group"},
        "sender": {"id": "wecom-user-1", "display_name": "Wei"},
        "content": [{"type": "text", "text": "@agent deploy v2"}],
        "addressed": True,
        "native": {"message_id": "98234"},
    },
}


def test_worked_inbound_example_parses_and_locator_lands_untouched():
    event = parse_inbound_envelope(WORKED_INBOUND)

    assert event is not None
    assert event.external_id == "wecom-msg-98234"
    assert event.space_kind == ChannelSpaceKind.GROUP
    assert event.external_locator == {"chat_id": "grp_456"}
    assert event.addressed is True
    assert event.processed.content == [{"type": "text", "text": "@agent deploy v2"}]
    assert event.processed.sender == {"id": "wecom-user-1", "display_name": "Wei"}


def test_locator_never_reaches_a_uuid_field_directly():
    event = parse_inbound_envelope(WORKED_INBOUND)

    assert isinstance(event.external_locator["chat_id"], str)

    capabilities = ChannelCapabilities.model_validate(
        {"channel": "bridge", "identity": {"keys": {"space": ["chat_id"]}}}
    )
    key = compose_external_key(
        capabilities, ChannelKeyGrain.SPACE, event.external_locator
    )
    assert isinstance(key, UUID)


def test_unknown_top_level_field_is_accepted_and_discarded():
    payload = {**WORKED_INBOUND, "future_field": {"anything": True}}

    event = parse_inbound_envelope(payload)

    assert event is not None
    assert event.external_id == "wecom-msg-98234"


def test_unrecognised_type_is_ignored_not_raised():
    payload = {**WORKED_INBOUND, "type": "io.agenta.channel.reaction.added.v1"}

    event = parse_inbound_envelope(payload)

    assert event is None


def test_build_delivery_command_post_vs_edit_are_distinct_types():
    post = build_delivery_command(
        idempotency_key="k1", locator={"chat_id": "grp_456"}, content=[]
    )
    edit = build_delivery_command(
        idempotency_key="k2", locator={"chat_id": "grp_456"}, content=[], edit=True
    )

    assert post["type"] != edit["type"]
    assert post["idempotency_key"] == "k1"
    assert edit["idempotency_key"] == "k2"


def test_receipt_round_trips_external_locator_opaquely():
    receipt_payload = {
        "type": "bridge.receipt",
        "idempotency_key": "abc",
        "external_locator": {"chat_id": "grp_456", "message_id": "98241"},
    }

    locator = parse_receipt(receipt_payload)

    assert locator == {"chat_id": "grp_456", "message_id": "98241"}


def test_receipt_of_wrong_type_returns_none():
    assert parse_receipt({"type": "something.else"}) is None
