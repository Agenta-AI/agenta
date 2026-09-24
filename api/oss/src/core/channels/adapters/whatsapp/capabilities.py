from oss.src.core.channels.adapters.normalise import normalise_capabilities
from oss.src.core.channels.dtos import ChannelCapabilities

# Meta's documented limits for the Cloud API. One constant each, so a limit
# Meta changes is one edit.
TEXT_MAX_CHARS = 4096
REPLY_WINDOW_SECONDS = 24 * 60 * 60
# Reply buttons carry up to 3 options; a list message up to 10 rows. The
# declaration says 10 so core renders buttons up to 10, and the adapter picks
# reply buttons or a list by count. Above 10, core falls back to numbered text.
LIST_ROWS_MAX = 10
REPLY_BUTTONS_MAX = 3

# The static declaration for one WhatsApp business phone number. What differs
# from Slack and Telegram comes from the Cloud API itself:
#   - One-to-one only. Every conversation is one customer and one business
#     number; there are no groups or threads to key on.
#   - No edits. A sent message cannot be changed or deleted, so the turn shows
#     the native typing indicator instead of a "Thinking…" message.
#   - A 24-hour reply window, and STOP must be honored.
#   - No history API. Spaces self-register on first message.
WHATSAPP_CAPABILITIES: dict = {
    "channel": "whatsapp",
    "protocol": {"versions": ["0.1.0"]},
    "addressing": {
        "sigils": {"agent": None, "command": "/"},
        "mention": False,
        "commands": {"native": False, "in_conversation": True},
    },
    "spaces": {"private": True, "group": False, "topic": False},
    "conversation": {
        "units": ["thread", "space"],
        "default": "thread",
        "reply_window_seconds": REPLY_WINDOW_SECONDS,
        "opt_out": True,
    },
    "fill": {
        "backfill": {"supported": False, "requires_permission": None},
        "forwardfill": {"supported": True, "requires_permission": None},
    },
    "rendering": {
        "controls": {"update": False, "ephemeral": False, "indicator": "native"},
        "buttons": {"supported": True, "max": LIST_ROWS_MAX},
        # The agent writes Markdown; the adapter converts it to WhatsApp's own
        # *bold* / _italic_ / ~strike~ marks.
        "text": {"format": "markdown", "max_chars": TEXT_MAX_CHARS},
        "files": {
            # The agent has no way to return a file on any channel yet.
            "send": {"supported": False, "max_bytes": 0},
            # Images and documents are passed to the agent as attachments.
            "receive": {"supported": True, "max_bytes": 100 * 1024 * 1024},
        },
    },
    "identity": {
        "scope": "phone_number",
        "stable": True,
        "keys": {
            "connection": ["phone_number_id"],
            # The customer's WhatsApp id. One customer is one space and one
            # running conversation.
            "space": ["wa_id"],
            "thread": ["wa_id"],
        },
    },
    "setup": {
        "instructions": [
            "In Meta's App Dashboard, create a Business app and add the "
            "WhatsApp product.",
            "In WhatsApp > API Setup, copy the phone number ID of the number "
            "to connect.",
            "In Meta Business Settings, create a system user with access to "
            "your WhatsApp account, and generate a permanent token with the "
            "whatsapp_business_messaging and whatsapp_business_management "
            "permissions.",
            "In App settings > Basic, copy the app secret.",
            "Paste the three values here and connect. Meta bills your "
            "business directly for WhatsApp messages.",
            "In WhatsApp > Configuration, paste the callback URL and verify "
            "token Agenta shows you, then subscribe to the messages field.",
        ],
        "fields": [
            {
                "name": "phone_number_id",
                "label": "Phone number ID",
                "secret": False,
                "required": True,
                "help": "WhatsApp > API Setup in your Meta app",
                "pattern": r"^\d+$",
                "pattern_error": "A phone number ID is digits only.",
            },
            {
                "name": "access_token",
                "label": "Access token",
                "secret": True,
                "required": True,
                "help": "A permanent system-user token",
            },
            {
                "name": "app_secret",
                "label": "App secret",
                "secret": True,
                "required": True,
                "help": "App settings > Basic in your Meta app",
            },
            {
                "name": "reopen_template",
                "label": "Re-open template (optional)",
                "secret": False,
                "required": False,
                "help": (
                    "An approved template sent when a reply is ready after "
                    "the 24-hour window closed. Leave empty to hold the "
                    "reply and send nothing."
                ),
            },
            {
                "name": "reopen_template_language",
                "label": "Template language (optional)",
                "secret": False,
                "required": False,
                "help": "The template's language code. Defaults to en_US.",
            },
        ],
    },
    "commands": ["new"],
}


def fetch_whatsapp_capabilities() -> ChannelCapabilities:
    return normalise_capabilities(WHATSAPP_CAPABILITIES)
