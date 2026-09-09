"""Hosted Telegram capabilities: identity keys on the project, everything else
matches the custom bot. The hosted/custom split is the whole reason the hosted
path exists, so this guards the one field that must differ."""

from oss.src.core.channels.adapters.telegram.capabilities import (
    fetch_telegram_capabilities,
)
from oss.src.core.channels.adapters.telegram_hosted.capabilities import (
    fetch_telegram_hosted_capabilities,
)


def test_hosted_identity_keys_on_the_project_not_the_bot():
    caps = fetch_telegram_hosted_capabilities()
    assert caps.channel == "telegram_hosted"
    assert caps.identity.scope == "project"
    assert caps.identity.keys["connection"] == ["project"]
    # space and thread still key on the chat, like the custom bot
    assert caps.identity.keys["space"] == ["chat_id"]
    assert caps.identity.keys["thread"] == ["chat_id"]


def test_hosted_shares_the_custom_rendering_and_fill_facts():
    hosted = fetch_telegram_hosted_capabilities()
    custom = fetch_telegram_capabilities()
    assert hosted.rendering.text.format == custom.rendering.text.format == "html"
    assert hosted.rendering.controls.update is False
    assert hosted.fill.backfill.supported is False
    assert hosted.fill.forwardfill.supported is True
    assert hosted.conversation.default == custom.conversation.default


def test_hosted_has_no_paste_a_token_setup():
    caps = fetch_telegram_hosted_capabilities()
    # the hosted bot is tap-to-connect; there is no token field to paste
    assert caps.setup.fields == []
