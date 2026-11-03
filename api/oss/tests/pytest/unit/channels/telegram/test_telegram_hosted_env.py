"""The hosted Telegram config is 'enabled' only when the bot token, the webhook
secret, AND the bot username are all set; a half-configured deployment must not
look ready. Every case passes all three fields explicitly so the result does
not depend on the ambient environment (the dev container may have the vars set).
"""

from oss.src.utils.env import ChannelsTelegramConfig


def test_enabled_needs_the_token_and_the_secret():
    # a username is present throughout; the token and the secret are each required
    assert (
        ChannelsTelegramConfig(
            bot_token=None, webhook_secret=None, bot_username="b"
        ).enabled
        is False
    )
    assert (
        ChannelsTelegramConfig(
            bot_token="t", webhook_secret=None, bot_username="b"
        ).enabled
        is False
    )
    assert (
        ChannelsTelegramConfig(
            bot_token=None, webhook_secret="s", bot_username="b"
        ).enabled
        is False
    )
    assert (
        ChannelsTelegramConfig(
            bot_token="t", webhook_secret="s", bot_username="b"
        ).enabled
        is True
    )


def test_enabled_requires_a_username_too():
    # token + secret but no username: the deep link would degrade to
    # t.me/?start=... , which connects nothing.
    assert (
        ChannelsTelegramConfig(
            bot_token="t", webhook_secret="s", bot_username=None
        ).enabled
        is False
    )
    assert (
        ChannelsTelegramConfig(
            bot_token="t", webhook_secret="s", bot_username="b"
        ).enabled
        is True
    )
