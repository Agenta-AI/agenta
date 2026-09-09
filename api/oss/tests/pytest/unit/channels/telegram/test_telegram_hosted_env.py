"""The hosted Telegram config is 'enabled' only when both the bot token and the
webhook secret are set; a half-configured deployment must not look ready."""

from oss.src.utils.env import ChannelsTelegramConfig


def test_enabled_needs_both_token_and_secret():
    assert ChannelsTelegramConfig(bot_token=None, webhook_secret=None).enabled is False
    assert ChannelsTelegramConfig(bot_token="t", webhook_secret=None).enabled is False
    assert ChannelsTelegramConfig(bot_token=None, webhook_secret="s").enabled is False
    assert ChannelsTelegramConfig(bot_token="t", webhook_secret="s").enabled is True
