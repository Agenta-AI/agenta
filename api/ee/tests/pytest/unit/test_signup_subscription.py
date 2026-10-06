from unittest.mock import AsyncMock
from uuid import uuid4

import pytest

from ee.src.core.access.entitlements.types import DefaultPlan
from ee.src.core.subscriptions import service as subscriptions_service_module
from ee.src.core.subscriptions.service import SubscriptionsService


@pytest.mark.asyncio
async def test_cloud_signup_starts_on_the_free_plan_without_a_trial(monkeypatch):
    # No pricing entry carries `"trial": N`, so there is no reverse trial.
    monkeypatch.setattr(subscriptions_service_module, "trial_enabled", lambda: False)
    monkeypatch.setattr(
        type(subscriptions_service_module.env.stripe),
        "enabled",
        property(lambda self: True),
    )
    service = SubscriptionsService(subscriptions_dao=AsyncMock())
    service.start_plan = AsyncMock(return_value="subscription")
    service.start_reverse_trial = AsyncMock()

    organization_id = str(uuid4())
    result = await service.provision_subscription(
        organization_id=organization_id,
        organization_name="Org",
        organization_email="owner@example.com",
    )

    assert result == "subscription"
    service.start_plan.assert_awaited_once_with(
        organization_id=organization_id,
        plan=DefaultPlan.CLOUD_V0_HOBBY.value,
    )
    service.start_reverse_trial.assert_not_awaited()
