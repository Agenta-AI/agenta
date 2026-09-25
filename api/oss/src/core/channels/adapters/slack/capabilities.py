from oss.src.core.channels.adapters.normalise import normalise_capabilities
from oss.src.core.channels.dtos import ChannelCapabilities

SLACK_APP_ID_PATTERN = r"^A[A-Z0-9]+$"

SLACK_CAPABILITIES: dict = {
    "channel": "slack",
    "protocol": {"versions": ["0.1.0"]},
    "addressing": {
        # No agent sigil: a pasted "~10x" read as "address agent 10" and
        # dropped the reply. Every install has one agent per connection, so
        # routing falls through to the thread's agent or the default.
        "sigils": {"agent": None, "command": "!"},
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
            # api_app_id distinguishes two apps in one workspace; one of
            # enterprise_id/team_id is always "" -- an org-wide Enterprise
            # Grid install is one connection across many workspaces, keyed on
            # enterprise_id, never on the per-event team_id.
            "connection": ["api_app_id", "enterprise_id", "team_id"],
            "space": ["team", "channel"],
            "thread": ["team", "channel", "thread_ts"],
        },
    },
    "setup": {
        "instructions": [
            "Create a Slack app from the generated manifest (own app, not ours).",
            "Install it to your workspace and approve the requested scopes.",
            "Copy the App ID and the Signing Secret from Settings -> Basic Information.",
            "Copy the Bot User OAuth Token from Settings -> Install App.",
        ],
        "fields": [
            # Not secret: auth.test does not return it for a pasted bot
            # token, so the own-app flow asks for it alongside the two
            # secrets rather than leaving the connection key incomplete.
            # The Client ID sits next to it and has been pasted here; the
            # connection then never matches an event's api_app_id.
            {
                "name": "api_app_id",
                "label": "App ID",
                "secret": False,
                "required": True,
                "help": "Settings -> Basic Information. Starts with A. Not the Client ID.",
                "pattern": SLACK_APP_ID_PATTERN,
                "pattern_error": (
                    "This is not an App ID. Copy the App ID from Settings -> "
                    "Basic Information; it starts with A. The Client ID does not "
                    "go here."
                ),
            },
            {
                "name": "signing_secret",
                "label": "Signing Secret",
                "secret": True,
                "required": True,
                "help": "Settings -> Basic Information",
            },
            {
                "name": "bot_token",
                "label": "Bot User OAuth Token",
                "secret": True,
                "required": True,
                "help": "Settings -> Install App",
            },
        ],
    },
    "commands": ["new", "sessions", "use"],
}


def fetch_slack_capabilities() -> ChannelCapabilities:
    return normalise_capabilities(SLACK_CAPABILITIES)
