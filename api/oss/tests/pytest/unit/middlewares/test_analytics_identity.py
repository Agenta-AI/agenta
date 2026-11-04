"""Analytics identity: the person is the user id, the email is only a property,
and every event names the deployment it came from."""

from types import SimpleNamespace
from unittest.mock import MagicMock

import pytest

from oss.src.middlewares import analytics


@pytest.fixture
def posthog(monkeypatch):
    client = MagicMock()
    monkeypatch.setattr(analytics, "_load_posthog", lambda: client)
    monkeypatch.setattr(analytics, "get_instance_id", lambda: "instance-1")
    return client


def test_capture_uses_user_id_and_keeps_email_as_property(posthog):
    analytics.capture_user_event(
        user_id="user-1",
        event="app_created",
        properties={"path": "/apps"},
        email="test@agenta.ai",
    )

    posthog.capture.assert_called_once_with(
        "app_created",
        distinct_id="user-1",
        properties={
            "path": "/apps",
            "instance_id": "instance-1",
            "$set": {"email": "test@agenta.ai"},
        },
        groups={"instance": "instance-1"},
    )


def test_capture_without_instance_sends_no_group(posthog, monkeypatch):
    monkeypatch.setattr(analytics, "get_instance_id", lambda: None)

    analytics.capture_user_event(user_id="user-1", event="app_created")

    _, kwargs = posthog.capture.call_args
    assert kwargs["groups"] is None
    assert "instance_id" not in kwargs["properties"]


def test_capture_without_user_is_skipped(posthog):
    analytics.capture_user_event(user_id="", event="app_created")

    posthog.capture.assert_not_called()


@pytest.mark.asyncio
async def test_middleware_identifies_by_user_id(posthog, monkeypatch):
    monkeypatch.setattr(analytics.env.posthog, "api_key", "key", raising=False)

    async def no_activation(**_):
        return None

    monkeypatch.setattr(analytics, "_set_activation_property", no_activation)

    request = SimpleNamespace(
        url=SimpleNamespace(path="/apps"),
        method="POST",
        headers={"Authorization": "ApiKey x"},
        cookies={},
        state=SimpleNamespace(user_id="user-1", user_email="test@agenta.ai"),
    )

    async def call_next(_):
        return SimpleNamespace(status_code=200)

    await analytics.analytics_middleware(request, call_next)

    args, kwargs = posthog.capture.call_args
    assert args == ("app_created",)
    assert kwargs["distinct_id"] == "user-1"
    assert kwargs["properties"]["$set"] == {"email": "test@agenta.ai"}
    assert kwargs["groups"] == {"instance": "instance-1"}
