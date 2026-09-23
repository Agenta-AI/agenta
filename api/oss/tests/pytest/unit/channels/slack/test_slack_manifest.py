import json

import pytest

from oss.src.core.channels.adapters.slack.adapter import SlackAdapter
from oss.src.core.channels.adapters.slack.manifest import (
    SLACK_APP_DESCRIPTION_MAX,
    SLACK_APP_NAME_MAX,
    SLACK_BOT_DISPLAY_NAME_MAX,
    SLACK_BOT_SCOPES,
    build_slack_manifest,
)
from oss.src.core.channels.dtos import ChannelSetupIdentity

_URL = "https://example.test/events/"

# Slack refuses a manifest whose bot event lacks the scope that event requires.
_EVENT_SCOPES = {
    "message.channels": "channels:history",
    "message.groups": "groups:history",
    "message.im": "im:history",
    "message.mpim": "mpim:history",
    "app_mention": "app_mentions:read",
}


def test_every_bot_event_has_its_required_scope():
    manifest = build_slack_manifest(request_url="https://example.test/events/")
    scopes = set(manifest["oauth_config"]["scopes"]["bot"])
    events = manifest["settings"]["event_subscriptions"]["bot_events"]

    for event in events:
        assert event in _EVENT_SCOPES, f"no known scope mapping for {event}"
        assert _EVENT_SCOPES[event] in scopes, f"{event} needs {_EVENT_SCOPES[event]}"


def _identity(manifest):
    return (
        manifest["display_information"],
        manifest["features"]["bot_user"]["display_name"],
    )


def test_defaults_name_the_app_agenta_with_no_description():
    display, handle = _identity(build_slack_manifest(request_url=_URL))

    assert display == {"name": "Agenta"}
    assert handle == "Agenta"


def test_custom_values_land_in_the_manifest():
    display, handle = _identity(
        build_slack_manifest(
            request_url=_URL,
            name="Product Copilot",
            description="Answers product questions.",
            handle="product-copilot",
        )
    )

    assert display == {
        "name": "Product Copilot",
        "description": "Answers product questions.",
    }
    assert handle == "product-copilot"


def test_handle_is_derived_from_the_name_when_absent():
    _, handle = _identity(
        build_slack_manifest(request_url=_URL, name="Product Copilot")
    )

    assert handle == "ProductCopilot"


def test_handle_keeps_only_the_characters_slack_allows():
    _, handle = _identity(
        build_slack_manifest(request_url=_URL, handle="@my bot!/v2.0_beta-1")
    )

    assert handle == "mybotv2.0_beta-1"


def test_a_handle_with_nothing_allowed_falls_back_to_the_default():
    _, handle = _identity(build_slack_manifest(request_url=_URL, name="日本語"))

    assert handle == "Agenta"


def test_blank_values_fall_back_to_the_defaults():
    display, handle = _identity(
        build_slack_manifest(request_url=_URL, name="   ", description=" ", handle="")
    )

    assert display == {"name": "Agenta"}
    assert handle == "Agenta"


def test_values_are_fitted_to_slack_limits():
    display, handle = _identity(
        build_slack_manifest(
            request_url=_URL,
            name="n" * 100,
            description="line one\nline two " + "d" * 300,
            handle="h" * 200,
        )
    )

    assert len(display["name"]) == SLACK_APP_NAME_MAX
    assert len(display["description"]) == SLACK_APP_DESCRIPTION_MAX
    assert "\n" not in display["description"]
    assert len(handle) == SLACK_BOT_DISPLAY_NAME_MAX


def test_a_name_cut_at_the_limit_carries_no_trailing_space():
    display, _ = _identity(
        build_slack_manifest(request_url=_URL, name="a" * 34 + " tail")
    )

    assert display["name"] == "a" * 34


@pytest.mark.asyncio
async def test_setup_document_uses_the_given_identity():
    doc = await SlackAdapter().build_setup_document(
        request_url=_URL,
        identity=ChannelSetupIdentity(name="Support Bot", description="Helps."),
    )

    assert doc is not None
    manifest = json.loads(doc.content)
    assert manifest["display_information"] == {
        "name": "Support Bot",
        "description": "Helps.",
    }
    assert manifest["features"]["bot_user"]["display_name"] == "SupportBot"


def test_manifest_requests_channels_join_for_adding_public_channels():
    """Adding a public channel makes the bot join it via conversations.join,
    which needs channels:join."""
    manifest = build_slack_manifest(request_url="https://example.test/events/")

    assert "channels:join" in manifest["oauth_config"]["scopes"]["bot"]
    assert manifest["oauth_config"]["scopes"]["bot"] == SLACK_BOT_SCOPES


def test_manifest_requests_the_default_bot_scopes():
    """Requested at install so DMs, files, reactions and user lookups need no
    reinstall; the hosted authorize URL reads the same list."""
    scopes = set(
        build_slack_manifest(request_url="https://example.test/events/")[
            "oauth_config"
        ]["scopes"]["bot"]
    )

    assert {
        "chat:write",
        "channels:history",
        "groups:history",
        "im:history",
        "mpim:history",
        "channels:read",
        "groups:read",
        "im:read",
        "mpim:read",
        "app_mentions:read",
        "channels:join",
        "im:write",
        "files:read",
        "files:write",
        "reactions:write",
        "users:read",
        "users:read.email",
    } <= scopes
