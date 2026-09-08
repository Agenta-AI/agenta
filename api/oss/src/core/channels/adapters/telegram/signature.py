# Telegram webhook verification (Bot API "Marking webhooks as secure", 2026-09):
# setWebhook accepts a `secret_token`, and Telegram then sends it back on every
# update in the header X-Telegram-Bot-Api-Secret-Token. There is no HMAC and no
# timestamp: the check is a constant-time compare of that header against the
# secret we stored for this connection.

import hmac
from typing import Mapping

from oss.src.core.channels.types import ChannelSignatureInvalid

_SECRET_HEADER = "x-telegram-bot-api-secret-token"


def verify_telegram_secret(
    *,
    headers: Mapping[str, str],
    webhook_secret: str,
    channel: str = "telegram",
) -> None:
    """Raise ChannelSignatureInvalid unless the request carries the exact
    secret token we set on the webhook.

    Case-insensitive header lookup: callers passing a plain dict (tests) must
    lower-case their own keys, as with the Slack verifier.
    """

    presented = headers.get(_SECRET_HEADER)

    if not presented or not webhook_secret:
        raise ChannelSignatureInvalid(channel=channel)

    if not hmac.compare_digest(presented, webhook_secret):
        raise ChannelSignatureInvalid(channel=channel)
