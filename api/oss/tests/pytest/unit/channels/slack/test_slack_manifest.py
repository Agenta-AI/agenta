from oss.src.core.channels.adapters.slack.manifest import build_slack_manifest

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
