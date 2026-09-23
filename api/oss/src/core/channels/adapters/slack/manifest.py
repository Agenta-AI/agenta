import re
from typing import Any, Dict, List, Optional

# Scopes match exactly what adapter.py calls: chat:write (post/edit),
# channels:history/groups:history/im:history/mpim:history (fetch_history +
# discover_spaces read), channels:read/groups:read/im:read/mpim:read
# (discover_spaces listing), app_mentions:read (required by the app_mention
# bot event below; Slack rejects the manifest without it). No slash command registered in-thread —
# slash commands cannot be invoked in threads.
#
# Shared with the hosted install's authorize URL (oauth.py) -- one list, so
# the manifest a customer-owned app builds from and the scopes the hosted
# app requests can never drift apart.
SLACK_BOT_SCOPES: List[str] = [
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
]


# Slack's manifest limits (docs.slack.dev/reference/app-manifest). A value
# past a limit makes Slack reject the whole manifest, so every value is
# fitted here rather than trusted from the caller.
SLACK_APP_NAME_MAX = 35
SLACK_APP_DESCRIPTION_MAX = 140
SLACK_BOT_DISPLAY_NAME_MAX = 80

DEFAULT_SLACK_APP_NAME = "Agenta"

# Slack documents a-z, 0-9, "-", "_" and "." for the bot display name. Case
# is kept: the handle mirrors the app name people typed, and Slack accepts it.
_BOT_DISPLAY_NAME_DISALLOWED = re.compile(r"[^A-Za-z0-9._-]")


def _one_line(value: Optional[str]) -> str:
    return " ".join((value or "").split())


def slack_app_name(name: Optional[str]) -> str:
    return _one_line(name)[:SLACK_APP_NAME_MAX].strip() or DEFAULT_SLACK_APP_NAME


def slack_bot_display_name(handle: Optional[str], *, app_name: str) -> str:
    """The handle people mention (`@handle`). Derived from the app name when
    none is given; falls back to the default name when nothing survives."""

    source = handle if handle and handle.strip() else app_name
    cleaned = _BOT_DISPLAY_NAME_DISALLOWED.sub("", source.lstrip("@"))
    return cleaned[:SLACK_BOT_DISPLAY_NAME_MAX] or DEFAULT_SLACK_APP_NAME


def slack_app_description(description: Optional[str]) -> Optional[str]:
    return _one_line(description)[:SLACK_APP_DESCRIPTION_MAX].strip() or None


def build_slack_manifest(
    *,
    request_url: str,
    name: Optional[str] = None,
    description: Optional[str] = None,
    handle: Optional[str] = None,
) -> Dict[str, Any]:
    app_name = slack_app_name(name)
    display_information: Dict[str, Any] = {"name": app_name}
    app_description = slack_app_description(description)
    if app_description:
        display_information["description"] = app_description

    return {
        "display_information": display_information,
        "features": {
            "bot_user": {
                "display_name": slack_bot_display_name(handle, app_name=app_name),
                "always_online": True,
            },
        },
        "oauth_config": {"scopes": {"bot": SLACK_BOT_SCOPES}},
        "settings": {
            "event_subscriptions": {
                "request_url": request_url,
                "bot_events": [
                    "message.channels",
                    "message.im",
                    "message.mpim",
                    "message.groups",
                    "app_mention",
                ],
            },
            "interactivity": {
                "is_enabled": True,
                "request_url": request_url,
            },
            "org_deploy_enabled": False,
            "socket_mode_enabled": False,
        },
    }
