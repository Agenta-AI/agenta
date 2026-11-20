from oss.src.core.channels.adapters.normalise import normalise_capabilities
from oss.src.core.channels.dtos import ChannelCapabilities

TEXT_MAX_CHARS = 2000
# Five buttons fit in one action row.
BUTTONS_MAX = 5

# The static declaration for a Discord bot the user brings. What differs from
# the other channels comes from Discord itself:
#   - Messages arrive over the Discord Gateway socket, not a webhook, so there
#     is no ingress route to claim a connection from.
#   - No placeholder edits: Discord rate limits edits, so the turn shows the
#     native typing indicator and a reaction, and the answer comes as new
#     messages.
#   - A mention in a server channel opens a thread under that message, and the
#     space is the text channel, so a grant on the channel covers every thread.
DISCORD_CAPABILITIES: dict = {
    "channel": "discord",
    "protocol": {"versions": ["0.1.0"]},
    "addressing": {
        "sigils": {"agent": "~", "command": "!"},
        "mention": True,
        "commands": {"native": False, "in_conversation": True},
    },
    # Bots cannot join group DMs, so `group` is off; a server channel is a
    # topic, as a Slack channel is.
    "spaces": {"private": True, "group": False, "topic": True},
    "conversation": {"units": ["thread", "space"], "default": "thread"},
    "fill": {
        "backfill": {
            "supported": True,
            "requires_permission": "Message Content Intent",
        },
        "forwardfill": {
            "supported": True,
            "requires_permission": "Message Content Intent",
        },
    },
    "rendering": {
        "controls": {"update": False, "ephemeral": False, "indicator": "native"},
        "buttons": {"supported": True, "max": BUTTONS_MAX},
        "text": {"format": "markdown", "max_chars": TEXT_MAX_CHARS},
        "files": {
            "send": {"supported": False, "max_bytes": 0},
            "receive": {"supported": False, "max_bytes": 0},
        },
    },
    "identity": {
        "scope": "global",
        "stable": True,
        "keys": {
            "connection": ["application_id"],
            # `guild_id` is "" in a DM, so every grain composes there too.
            "space": ["guild_id", "channel_id"],
            "thread": ["guild_id", "channel_id", "thread_id"],
        },
    },
    "setup": {
        "instructions": [],
        "fields": [
            {
                "name": "bot_token",
                "label": "Bot token",
                "secret": True,
                "required": True,
            },
        ],
    },
    "commands": ["new", "sessions", "use"],
}


def fetch_discord_capabilities() -> ChannelCapabilities:
    return normalise_capabilities(DISCORD_CAPABILITIES)
