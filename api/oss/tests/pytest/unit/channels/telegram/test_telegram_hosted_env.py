"""The hosted Telegram config is 'enabled' only when both the bot token and the
webhook secret are set; a half-configured deployment must not look ready."""

from oss.src.utils.env import ChannelsTelegramConfig


def test_enabled_needs_both_token_and_secret():
    assert ChannelsTelegramConfig(bot_token=None, webhook_secret=None).enabled is False
    assert ChannelsTelegramConfig(bot_token="t", webhook_secret=None).enabled is False
    assert ChannelsTelegramConfig(bot_token=None, webhook_secret="s").enabled is False
    assert ChannelsTelegramConfig(bot_token="t", webhook_secret="s").enabled is True


def test_enabled_requires_a_username_too():
    from oss.src.utils.env import ChannelsTelegramConfig

    # token + secret but no username: the deep link would be t.me/?start=...
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
