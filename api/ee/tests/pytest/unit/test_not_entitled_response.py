import json

import pytest

import ee.src.core.access.entitlements.service as entitlements_service
from ee.src.core.access.entitlements.types import Tracker

CLOUD_MESSAGE = (
    "You do not have access to this feature. Please upgrade your plan to continue."
)
SELF_HOSTED_MESSAGE = "Available on the Enterprise plan."


@pytest.mark.parametrize(
    "cloud, message",
    [(True, CLOUD_MESSAGE), (False, SELF_HOSTED_MESSAGE)],
)
def test_locked_feature_message_depends_on_cloud(monkeypatch, cloud, message):
    monkeypatch.setattr(entitlements_service, "is_cloud", lambda: cloud)

    response = entitlements_service.NOT_ENTITLED_RESPONSE(Tracker.FLAGS)

    assert response.status_code == 403
    assert json.loads(response.body) == {"detail": message}


@pytest.mark.parametrize("cloud", [True, False])
def test_quota_messages_do_not_change_on_self_hosted(monkeypatch, cloud):
    monkeypatch.setattr(entitlements_service, "is_cloud", lambda: cloud)

    counters = entitlements_service.NOT_ENTITLED_RESPONSE(Tracker.COUNTERS)
    gauges = entitlements_service.NOT_ENTITLED_RESPONSE(Tracker.GAUGES)

    assert json.loads(counters.body)["detail"] == (
        "You have reached your monthly quota limit. Please upgrade your plan to continue."
    )
    assert json.loads(gauges.body)["detail"] == (
        "You have reached your quota limit. Please upgrade your plan to continue."
    )
