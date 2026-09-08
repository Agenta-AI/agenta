from oss.src.core.channels.adapters.normalise import normalise_capabilities
from oss.src.core.channels.dtos import ChannelCapabilities

# The static declaration for a Telegram bot. Two things differ sharply from
# Slack, and both come from the Bot API itself, not from a product choice:
#   - No history. A bot cannot read messages sent before it joined, and cannot
#     list the chats it is in. So backfill is unsupported and discover_spaces
#     returns nothing; spaces self-register on first message.
#   - Identity rides the webhook, not the payload. A Telegram update never says
#     which bot it is for, so the connection is keyed on the bot id carried in
#     the per-bot ingress path, not on a field in the body.
TELEGRAM_CAPABILITIES: dict = {
    "channel": "telegram",
    "protocol": {"versions": ["0.1.0"]},
    "addressing": {
        # A bot is addressed by @its_username, or by a /command. There is no
        # separate sigil vocabulary the way Slack rewrites @mention away.
        "sigils": {"agent": None, "command": "/"},
        "mention": True,
        "commands": {"native": True, "in_conversation": True},
    },
    # private = a 1:1 chat with the bot; group = a group or supergroup;
    # topic = a forum topic inside a supergroup (message_thread_id).
    "spaces": {"private": True, "group": True, "topic": True},
    # A chat is one running conversation. "thread" as the default makes the
    # session scope THREAD, so every message in a direct message or a group
    # continues the same session instead of starting a fresh one. Without this
    # each message got its own session and the agent had no memory.
    "conversation": {"units": ["thread", "space"], "default": "thread"},
    "fill": {
        # The Bot API has no history read for a bot. Never claim backfill.
        "backfill": {"supported": False, "requires_permission": None},
        # Forwardfill reads our own stored events, so it needs no platform
        # permission and works the same as on Slack.
        "forwardfill": {"supported": True, "requires_permission": None},
    },
    "rendering": {
        # No placeholder-then-edit. The turn-start indicator is the native
        # "typing…" action, and the answer is posted as its own fresh message,
        # so update is off. (editMessageText still exists on the adapter for a
        # future in-place-edit use, it is just not driven by the outbox here.)
        "controls": {"update": False, "ephemeral": False},
        # inline_keyboard buttons; callback_data is capped at 64 bytes, which
        # the approval tokens fit inside.
        "buttons": {"supported": True, "max": 8},
        # parse_mode=HTML with a small tag set; 4096 is Telegram's message
        # length ceiling.
        "text": {"format": "html", "max_chars": 4096},
        # Files are declared off for the first cut; send/receive come later.
        "files": {
            "send": {"supported": False, "max_bytes": 0},
            "receive": {"supported": False, "max_bytes": 0},
        },
    },
    "identity": {
        "scope": "bot",
        "stable": True,
        "keys": {
            # A custom bot is one bot, so the bot id alone identifies the
            # connection. The hosted, Agenta-owned bot keys on the project
            # instead and resolves the chat-to-project map at bind time; that
            # path is added separately.
            "connection": ["bot_id"],
            "space": ["chat_id"],
            # v1 keys a conversation on the chat, so a direct message and a
            # group each stay one thread. A group without a message id would
            # otherwise fail to compose a thread key. Forum-topic separation
            # (message_thread_id) is a later refinement.
            "thread": ["chat_id"],
        },
    },
    "setup": {
        "instructions": [
            "Open @BotFather in Telegram and send /newbot.",
            "Choose a name and a username for your bot.",
            "Copy the bot token BotFather gives you.",
            "Paste the bot token here and connect.",
        ],
        "fields": [
            {
                "name": "bot_token",
                "label": "Bot token",
                "secret": True,
                "required": True,
                "help": "From @BotFather, after /newbot",
            },
        ],
    },
    "commands": ["new", "sessions", "use"],
}


def fetch_telegram_capabilities() -> ChannelCapabilities:
    return normalise_capabilities(TELEGRAM_CAPABILITIES)
