import copy

from oss.src.core.channels.adapters.normalise import normalise_capabilities
from oss.src.core.channels.adapters.telegram.capabilities import TELEGRAM_CAPABILITIES
from oss.src.core.channels.dtos import ChannelCapabilities

# The hosted (Agenta-owned) Telegram bot is ONE bot shared by every project, so
# an inbound update cannot be keyed on the bot id the way a custom bot is: every
# hosted connection would share it. A hosted connection keys on the PROJECT
# instead, and the shared ingress resolves (bot_id, chat_id) -> project from the
# chat-to-project binding written at account-bind time. Everything else — the
# rendering, the addressing, the no-history facts — is identical to the custom
# bot, so this declaration is the custom one with only the identity changed.
TELEGRAM_HOSTED_CAPABILITIES: dict = copy.deepcopy(TELEGRAM_CAPABILITIES)
TELEGRAM_HOSTED_CAPABILITIES["channel"] = "telegram_hosted"
TELEGRAM_HOSTED_CAPABILITIES["identity"] = {
    "scope": "project",
    "stable": True,
    "keys": {
        # One hosted connection per project; the bind map resolves the chat.
        "connection": ["project"],
        # Space and thread still key on the chat, so a direct message and a
        # group each stay one conversation, exactly as the custom bot does.
        "space": ["chat_id"],
        "thread": ["chat_id"],
    },
}
# The hosted bot has no per-project token to paste: the user taps a link and
# runs /start in Telegram. The connect UI drives that, so there is no token
# field and no BotFather steps here.
TELEGRAM_HOSTED_CAPABILITIES["setup"] = {"instructions": [], "fields": []}


def fetch_telegram_hosted_capabilities() -> ChannelCapabilities:
    return normalise_capabilities(TELEGRAM_HOSTED_CAPABILITIES)
