"""Capability declaration for `agenta` — the platform is us, so this declares
the ceiling: every arm true, at the widest normalised value. Every other
channel's declaration is what it degrades *from* this.
"""

from oss.src.core.channels.adapters.normalise import normalise_capabilities
from oss.src.core.channels.dtos import ChannelCapabilities

AGENTA_CAPABILITIES: dict = {
    "channel": "agenta",
    "protocol": {"versions": ["0.1.0"]},
    "addressing": {
        "sigils": {"agent": "~", "command": "!"},
        # no native @mention distinct from the sigil
        "mention": False,
        "commands": {"native": False, "in_conversation": True},
    },
    "spaces": {"private": True, "group": True, "topic": True},
    "conversation": {"units": ["thread", "space"], "default": "thread"},
    "fill": {
        # nothing predates our own log -- there is no platform history to pull
        "backfill": {"supported": False, "requires_permission": None},
        "forwardfill": {"supported": True, "requires_permission": None},
    },
    "rendering": {
        "controls": {"update": True, "ephemeral": True},
        "buttons": {"supported": True, "max": 100},
        "text": {"format": "markdown", "max_chars": 40000},
        "files": {
            "send": {"supported": True, "max_bytes": 10 * 1024 * 1024 * 1024},
            "receive": {"supported": True, "max_bytes": 10 * 1024 * 1024 * 1024},
        },
    },
    "identity": {
        "scope": "project",
        "stable": True,
        "keys": {
            "connection": ["project", "bot"],
            "space": ["user"],
            "thread": ["thread"],
        },
    },
    "commands": ["new", "sessions", "use"],
}


def fetch_agenta_capabilities() -> ChannelCapabilities:
    return normalise_capabilities(AGENTA_CAPABILITIES)
