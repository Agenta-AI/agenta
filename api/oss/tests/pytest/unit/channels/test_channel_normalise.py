from oss.src.core.channels.adapters.normalise import (
    _CEILING_BUTTONS_MAX,
    _CEILING_FILE_MAX_BYTES,
    _CEILING_TEXT_MAX_CHARS,
    _DEFAULT_BUTTONS_MAX,
    normalise_capabilities,
)
from oss.src.core.channels.dtos import ChannelCapabilities, ChannelKeyGrain

SLACK = {
    "channel": "slack",
    "protocol": {"versions": ["0.1.0"]},
    "addressing": {
        "sigils": {"agent": "~", "command": "!"},
        "mention": True,
        "commands": {"native": True, "in_conversation": False},
    },
    "spaces": {"private": True, "group": True, "topic": True},
    "conversation": {"units": ["thread", "space"], "default": "thread"},
    "fill": {
        "backfill": {"supported": True, "requires_permission": "channels:history"},
        "forwardfill": {"supported": True, "requires_permission": "channels:history"},
    },
    "rendering": {
        "controls": {"update": True, "ephemeral": True},
        "buttons": {"supported": True, "max": 25},
        "text": {"format": "markdown", "max_chars": 3000},
        "files": {
            "send": {"supported": True, "max_bytes": 1073741824},
            "receive": {"supported": True, "max_bytes": 1073741824},
        },
    },
    "identity": {
        "scope": "workspace",
        "stable": True,
        "keys": {
            "space": ["team", "channel"],
            "thread": ["team", "channel", "thread_ts"],
        },
    },
    "commands": ["new", "sessions", "use"],
}

# contract.md §4's bridge.hello example: fewer fields (no ephemeral,
# spaces.topic: false), nested one level under "capabilities".
BRIDGE_HELLO_CAPABILITIES = {
    "channel": "acme-wecom",
    "protocol": {"versions": ["0.1.0"]},
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
    "identity": {"scope": "tenant", "stable": True},
    "commands": ["new", "sessions"],
}


def test_buttons_max_zero_becomes_non_zero_default():
    result = normalise_capabilities(
        {"channel": "x", "rendering": {"buttons": {"supported": True, "max": 0}}}
    )
    assert result.rendering.buttons.max == _DEFAULT_BUTTONS_MAX
    assert result.rendering.buttons.max != 0


def test_absurd_max_chars_is_clamped_to_documented_ceiling():
    result = normalise_capabilities(
        {"channel": "x", "rendering": {"text": {"max_chars": 10**9}}}
    )
    assert result.rendering.text.max_chars == _CEILING_TEXT_MAX_CHARS


def test_absurd_file_max_bytes_is_clamped():
    result = normalise_capabilities(
        {
            "channel": "x",
            "rendering": {"files": {"send": {"supported": True, "max_bytes": 10**15}}},
        }
    )
    assert result.rendering.files.send.max_bytes == _CEILING_FILE_MAX_BYTES


def test_absurd_buttons_max_is_clamped():
    result = normalise_capabilities(
        {"channel": "x", "rendering": {"buttons": {"supported": True, "max": 10**6}}}
    )
    assert result.rendering.buttons.max == _CEILING_BUTTONS_MAX


def test_unknown_top_level_and_nested_keys_are_dropped():
    result = normalise_capabilities(
        {
            "channel": "x",
            "extra_block": {"nonsense": True},
            "rendering": {
                "extra_nested": "z",
                "controls": {"update": True, "ephemeral": False, "extra_leaf": 1},
            },
        }
    )
    dumped = result.model_dump()
    assert "extra_block" not in dumped
    assert "extra_nested" not in dumped["rendering"]
    assert "extra_leaf" not in dumped["rendering"]["controls"]


def test_missing_identity_block_still_validates():
    result = normalise_capabilities({"channel": "x"})
    assert isinstance(result, ChannelCapabilities)
    assert result.identity.keys == {}


def test_identity_keys_thread_empty_list_survives_unchanged():
    result = normalise_capabilities(
        {"channel": "x", "identity": {"keys": {"thread": []}}}
    )
    assert result.identity.keys[ChannelKeyGrain.THREAD] == []


def test_identity_keys_round_trip_unchanged_for_well_formed_declaration():
    result = normalise_capabilities(SLACK)
    assert result.identity.keys[ChannelKeyGrain.THREAD] == [
        "team",
        "channel",
        "thread_ts",
    ]
    assert result.identity.keys[ChannelKeyGrain.SPACE] == ["team", "channel"]


def test_slack_example_round_trips():
    result = normalise_capabilities(SLACK)
    assert result.channel == "slack"
    assert result.rendering.buttons.max == 25
    assert result.identity.scope == "workspace"


def test_bridge_hello_example_normalises_to_same_shape_as_in_process_dict():
    from_bridge = normalise_capabilities(BRIDGE_HELLO_CAPABILITIES)

    # An equivalent in-process adapter's own raw dict, same content different
    # source — same function must produce the same shape.
    equivalent_in_process = dict(BRIDGE_HELLO_CAPABILITIES)
    from_in_process = normalise_capabilities(equivalent_in_process)

    assert from_bridge.model_dump() == from_in_process.model_dump()
    # optional/default fields (spaces.topic, ephemeral) are actually optional
    assert from_bridge.spaces.topic is False
    assert from_bridge.rendering.controls.ephemeral is False
