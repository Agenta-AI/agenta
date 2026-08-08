import pytest

from oss.src.core.channels.adapters.bridge.hello import (
    BridgeProtocolUnsupported,
    parse_hello,
)
from oss.src.core.channels.dtos import ChannelKeyGrain

WORKED_EXAMPLE = {
    "type": "bridge.hello",
    "protocol": {"versions": ["0.1.0"]},
    "bridge": {"name": "acme-wecom", "version": "1.2.0"},
    "capabilities": {
        "addressing": {"sigils": {"agent": "~", "command": "!"}, "mention": True},
        "spaces": {"private": True, "group": True, "topic": False},
        "conversation": {"units": ["space"], "default": "space"},
        "fill": {
            "backfill": {"supported": False},
            "forwardfill": {"supported": True},
        },
        "rendering": {
            "controls": {"update": True, "ephemeral": False},
            "buttons": {"supported": True, "max": 3},
            "text": {"format": "plain", "max_chars": 2048},
            "files": {
                "send": {"supported": False, "max_bytes": 0},
                "receive": {"supported": True, "max_bytes": 10485760},
            },
        },
        "identity": {
            "scope": "tenant",
            "stable": True,
            "keys": {"space": ["chat_id"], "thread": []},
        },
        "commands": ["new", "sessions"],
    },
}


def test_worked_example_registers_and_round_trips_unchanged():
    capabilities = parse_hello(WORKED_EXAMPLE)

    assert capabilities.rendering.buttons.max == 3
    assert capabilities.rendering.text.max_chars == 2048
    assert capabilities.identity.keys == {
        ChannelKeyGrain.SPACE: ["chat_id"],
        ChannelKeyGrain.THREAD: [],
    }
    assert capabilities.conversation.units == [ChannelKeyGrain.SPACE]


def test_absurd_value_clamps_and_declared_zero_takes_the_default():
    payload = {
        **WORKED_EXAMPLE,
        "capabilities": {
            **WORKED_EXAMPLE["capabilities"],
            "rendering": {
                **WORKED_EXAMPLE["capabilities"]["rendering"],
                "buttons": {"supported": True, "max": 999999},
                "text": {"format": "plain", "max_chars": 0},
            },
        },
    }

    capabilities = parse_hello(payload)

    assert capabilities.rendering.buttons.max == 100  # the ceiling, not the claim
    assert capabilities.rendering.text.max_chars == 3000  # 0 -> default


def test_unknown_key_is_dropped_without_error():
    payload = {
        **WORKED_EXAMPLE,
        "capabilities": {
            **WORKED_EXAMPLE["capabilities"],
            "unknown_future_block": {"whatever": True},
        },
    }

    capabilities = parse_hello(payload)

    assert not hasattr(capabilities, "unknown_future_block")


def test_hello_missing_the_pinned_protocol_version_is_rejected():
    payload = {**WORKED_EXAMPLE, "protocol": {"versions": ["2.0.0"]}}

    with pytest.raises(BridgeProtocolUnsupported):
        parse_hello(payload)


def test_identity_keys_no_threads_survives_normalisation_and_composes_none():
    from oss.src.core.channels.utils import compose_external_key

    capabilities = parse_hello(WORKED_EXAMPLE)

    result = compose_external_key(
        capabilities, ChannelKeyGrain.THREAD, {"chat_id": "grp_456"}
    )
    assert result is None
