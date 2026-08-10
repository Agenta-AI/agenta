from oss.src.core.channels.adapters.slack.capabilities import fetch_slack_capabilities
from oss.src.core.channels.dtos import ChannelKeyGrain

# The Slack capabilities worked example, field for field.
EXPECTED = {
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
        "buttons": {"supported": True, "max": 5},
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
            "connection": ["api_app_id", "enterprise_id", "team_id"],
            "space": ["team", "channel"],
            "thread": ["team", "channel", "thread_ts"],
        },
    },
    "commands": ["new", "sessions", "use"],
}


def test_declared_value_matches_spec_field_for_field():
    capabilities = fetch_slack_capabilities()

    assert capabilities.model_dump(mode="json") == EXPECTED


def test_text_max_chars_is_the_enforced_block_kit_ceiling_not_the_client_guidance():
    """4000 is Slack's client-side guidance; 3000 is the enforced Block Kit
    ceiling, which is what the renderer must respect."""

    capabilities = fetch_slack_capabilities()

    assert capabilities.rendering.text.max_chars == 3000


def test_identity_keys_included_and_uses_key_grain_vocabulary():
    capabilities = fetch_slack_capabilities()

    assert capabilities.identity.keys[ChannelKeyGrain.SPACE] == ["team", "channel"]
    assert capabilities.identity.keys[ChannelKeyGrain.THREAD] == [
        "team",
        "channel",
        "thread_ts",
    ]


def test_conversation_units_use_key_grain_not_session_scope_vocabulary():
    """The C0/C1 defect this package must not repeat: units is
    {thread, space}, never {thread, message}."""

    capabilities = fetch_slack_capabilities()

    assert set(capabilities.conversation.units) == {
        ChannelKeyGrain.THREAD,
        ChannelKeyGrain.SPACE,
    }
    assert capabilities.conversation.default == ChannelKeyGrain.THREAD
