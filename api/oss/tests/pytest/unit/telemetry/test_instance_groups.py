"""Self-hosted per-user events name the instance as a PostHog group; cloud events
carry no group."""

from types import SimpleNamespace
from unittest.mock import AsyncMock
from uuid import UUID

import pytest

from oss.src.core.auth.supertokens import overrides
from oss.src.middlewares import analytics
from oss.src.core.telemetry import service as telemetry_service
from oss.src.utils import lazy
from oss.src.utils.env import env

INSTANCE_ID = UUID("3f0c9a52-6d1e-4b8a-9f7e-2a5c8d4e1b07")
USER_ID = UUID("8b2d4f6a-1c3e-4a5b-8d7f-9e0a1b2c3d4e")
EMAIL = "ada@example.com"


class _Recorder:
    def __init__(self):
        self.calls = []

    def capture(self, event=None, **kwargs):
        self.calls.append({"event": event, **kwargs})


@pytest.fixture
def queued(monkeypatch):
    recorder = _Recorder()
    monkeypatch.setattr(lazy, "_import_posthog", lambda: recorder)
    monkeypatch.setattr(env.telemetry, "enabled", True)
    monkeypatch.setattr(
        telemetry_service, "get_instance_id", AsyncMock(return_value=INSTANCE_ID)
    )
    return recorder


@pytest.fixture
def self_hosted(monkeypatch):
    monkeypatch.setattr(env.stripe, "api_key", None)


@pytest.fixture
def cloud(monkeypatch):
    monkeypatch.setattr(env.stripe, "api_key", "sk_test_not_a_real_key")


def _request():
    return SimpleNamespace(
        url=SimpleNamespace(path="/apps"),
        method="POST",
        headers={"Authorization": "ApiKey abc"},
        cookies={},
        state=SimpleNamespace(user_email=EMAIL, user_id=str(USER_ID)),
    )


async def _call_next(_request):
    return SimpleNamespace(status_code=200)


@pytest.fixture
def sign_up(monkeypatch):
    monkeypatch.setattr(
        overrides,
        "ensure_auth_info_not_blocked",
        AsyncMock(side_effect=lambda auth_info: auth_info),
    )
    monkeypatch.setattr(overrides, "get_user_with_email", AsyncMock(return_value=None))
    monkeypatch.setattr(
        overrides,
        "create_accounts",
        AsyncMock(return_value=SimpleNamespace(id=USER_ID, email=EMAIL)),
    )


@pytest.mark.asyncio
async def test_self_hosted_event_names_the_instance_group(self_hosted, queued):
    await analytics.analytics_middleware(_request(), _call_next)

    [call] = queued.calls
    assert call["properties"]["$groups"] == {"instance": str(INSTANCE_ID)}


@pytest.mark.asyncio
async def test_self_hosted_sign_up_names_the_instance_group(
    self_hosted, queued, sign_up
):
    await overrides._create_account(EMAIL, "uid")

    [call] = queued.calls
    assert call["properties"]["$groups"] == {"instance": str(INSTANCE_ID)}


@pytest.mark.asyncio
async def test_cloud_events_carry_no_group(cloud, queued, sign_up):
    await analytics.analytics_middleware(_request(), _call_next)
    await overrides._create_account(EMAIL, "uid")

    assert len(queued.calls) == 2
    for call in queued.calls:
        assert "$groups" not in call["properties"]
