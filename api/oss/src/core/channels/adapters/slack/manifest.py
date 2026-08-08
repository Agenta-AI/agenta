from typing import Any, Dict

# Scopes match exactly what adapter.py calls: chat:write (post/edit),
# channels:history/groups:history/im:history/mpim:history (fetch_history +
# discover_spaces read), channels:read/groups:read/im:read/mpim:read
# (discover_spaces listing). No slash command registered in-thread —
# slash commands cannot be invoked in threads.


def build_slack_manifest(*, request_url: str) -> Dict[str, Any]:
    return {
        "display_information": {"name": "Agenta"},
        "features": {
            "bot_user": {"display_name": "Agenta", "always_online": True},
        },
        "oauth_config": {
            "scopes": {
                "bot": [
                    "chat:write",
                    "channels:history",
                    "groups:history",
                    "im:history",
                    "mpim:history",
                    "channels:read",
                    "groups:read",
                    "im:read",
                    "mpim:read",
                ]
            }
        },
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
