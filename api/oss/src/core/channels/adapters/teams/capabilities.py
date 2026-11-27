from oss.src.core.channels.adapters.normalise import normalise_capabilities
from oss.src.core.channels.dtos import ChannelCapabilities

# Far below Microsoft's 80 KB advice per message, even with wide characters.
TEXT_MAX_CHARS = 20000
BUTTONS_MAX = 5

GUID_PATTERN = (
    r"^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$"
)
GUID_PATTERN_ERROR = (
    "Enter the ID as a GUID, for example 00000000-0000-0000-0000-000000000000."
)

# The static declaration for a Teams bot the user registers in their own
# tenant. What differs from the other channels comes from Teams itself:
#   - Without resource-specific consent, a bot in a group chat or a channel
#     receives only the messages that mention it, so there is no agent sigil.
#   - No placeholder edits: the turn shows the typing signal, then the
#     working message.
#   - A team channel is a topic and its reply chains are threads. A group
#     chat has no threads, so `thread_id` is "" there and the chat is one
#     thread.
TEAMS_CAPABILITIES: dict = {
    "channel": "teams",
    "protocol": {"versions": ["0.1.0"]},
    "addressing": {
        "sigils": {"agent": None, "command": "!"},
        "mention": True,
        "commands": {"native": False, "in_conversation": True},
    },
    "spaces": {"private": True, "group": True, "topic": True},
    "conversation": {
        "units": ["thread", "space"],
        "default": "thread",
        "reply_window_seconds": 0,
    },
    "fill": {
        "backfill": {"supported": False, "requires_permission": None},
        "forwardfill": {"supported": True, "requires_permission": None},
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
        "scope": "tenant",
        "stable": True,
        "keys": {
            "connection": ["app_id"],
            "space": ["tenant_id", "conversation_id"],
            "thread": ["tenant_id", "conversation_id", "thread_id"],
        },
    },
    "setup": {
        "instructions": [],
        "fields": [
            {
                "name": "app_id",
                "label": "Application (client) ID",
                "secret": False,
                "required": True,
                "pattern": GUID_PATTERN,
                "pattern_error": GUID_PATTERN_ERROR,
            },
            {
                "name": "client_secret",
                "label": "Client secret value",
                "secret": True,
                "required": True,
                "help": "Copy the secret's Value, not its Secret ID.",
            },
            {
                "name": "tenant_id",
                "label": "Directory (tenant) ID",
                "secret": False,
                "required": True,
                "pattern": GUID_PATTERN,
                "pattern_error": GUID_PATTERN_ERROR,
            },
        ],
    },
    "commands": ["new", "sessions", "use"],
}


def fetch_teams_capabilities() -> ChannelCapabilities:
    return normalise_capabilities(TEAMS_CAPABILITIES)
