import pytest


@pytest.fixture(autouse=True)
def _no_slack_sender_lookup(monkeypatch):
    """Unit tests never reach Slack: sender names come from the event only.
    Tests of the lookup itself turn it back on with their own stub client."""
    from oss.src.core.channels.adapters.slack import adapter

    monkeypatch.setattr(adapter.SlackAdapter, "resolve_sender_names", False)
    adapter._SENDER_CACHE.clear()


@pytest.fixture(autouse=True)
def _allowing_access_service(monkeypatch):
    """Durable-work consumers here build run envelopes and recheck access through the
    registered AccessService. Tests that are not about the decision get one that
    allows; tests about it register their own."""
    from oss.tests.pytest.utils.principals import register_allowing_access_service

    return register_allowing_access_service(monkeypatch)
