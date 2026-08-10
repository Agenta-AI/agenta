from oss.src.core.channels.adapters.normalise import normalise_capabilities
from oss.src.core.channels.dtos import ChannelCapabilities

SLACK_CAPABILITIES: dict = {
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
        # 4000 is Slack's client guidance; 3000 is the enforced Block Kit ceiling.
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


def fetch_slack_capabilities() -> ChannelCapabilities:
    return normalise_capabilities(SLACK_CAPABILITIES)
