"""Stripe first (cloud, unchanged), then the license key, then the community plan.
No env plan setting gives an instance without Stripe an enterprise flag."""

from unittest.mock import AsyncMock
from uuid import uuid4

import pytest

from oss.src.utils.env import env

import ee.src.core.access.entitlements.service as entitlements_service
import ee.src.core.subscriptions.service as subscriptions_service_module
import ee.src.middlewares.throttling as throttling
from ee.src.core.access.entitlements.controls import build_plan_controls
from ee.src.core.access.entitlements.types import Flag, Tracker
from ee.src.core.subscriptions.service import SubscriptionsService
from ee.src.core.subscriptions.types import SubscriptionDTO

COMMUNITY = "self_hosted_community"
REGISTERED = "self_hosted_registered"
ENTERPRISE = "self_hosted_enterprise"


def _subscriptions(plan: str) -> SubscriptionsService:
    dao = AsyncMock()
    dao.read.return_value = SubscriptionDTO(
        organization_id=uuid4(), plan=plan, active=True, anchor=7
    )
    return SubscriptionsService(subscriptions_dao=dao)


@pytest.mark.asyncio
async def test_with_stripe_the_subscription_plan_is_unchanged(cloud, monkeypatch):
    instance_plan = AsyncMock(return_value=COMMUNITY)
    monkeypatch.setattr(subscriptions_service_module, "instance_plan", instance_plan)
    service = _subscriptions("cloud_v0_pro")

    subscription = await service.read(organization_id=str(uuid4()))

    assert subscription.plan == "cloud_v0_pro"
    instance_plan.assert_not_awaited()


@pytest.mark.asyncio
async def test_without_stripe_the_subscription_plan_is_the_instance_plan(
    self_hosted, monkeypatch
):
    monkeypatch.setattr(
        subscriptions_service_module,
        "instance_plan",
        AsyncMock(return_value=COMMUNITY),
    )
    service = _subscriptions(ENTERPRISE)

    subscription = await service.read(organization_id=str(uuid4()))

    assert subscription.plan == COMMUNITY
    assert subscription.anchor == 7
    service.subscriptions_dao.update.assert_not_awaited()


@pytest.mark.asyncio
async def test_with_stripe_entitlements_read_the_subscription(cloud, monkeypatch):
    instance_plan = AsyncMock(return_value=COMMUNITY)
    monkeypatch.setattr(entitlements_service, "instance_plan", instance_plan)
    monkeypatch.setattr(
        entitlements_service,
        "_subscriptions_service_singleton",
        _subscriptions("cloud_v0_business"),
    )

    data = await entitlements_service._subscription_data(uuid4())

    assert data == {"plan": "cloud_v0_business", "anchor": 7}
    instance_plan.assert_not_awaited()


@pytest.mark.asyncio
async def test_without_stripe_entitlements_use_the_instance_plan(
    self_hosted, monkeypatch
):
    monkeypatch.setattr(
        entitlements_service, "instance_plan", AsyncMock(return_value=ENTERPRISE)
    )
    monkeypatch.setattr(
        subscriptions_service_module,
        "instance_plan",
        AsyncMock(return_value=ENTERPRISE),
    )
    monkeypatch.setattr(
        entitlements_service,
        "_subscriptions_service_singleton",
        _subscriptions(COMMUNITY),
    )

    data = await entitlements_service._subscription_data(uuid4())

    assert data == {"plan": ENTERPRISE, "anchor": 7}


@pytest.mark.asyncio
async def test_without_stripe_a_cached_plan_gives_way_to_the_instance_plan(
    self_hosted, monkeypatch
):
    cached = {"plan": COMMUNITY, "anchor": 7}
    monkeypatch.setattr(
        entitlements_service, "get_cache", AsyncMock(return_value=cached)
    )
    monkeypatch.setattr(throttling, "get_cache", AsyncMock(return_value=cached))
    monkeypatch.setattr(
        entitlements_service, "instance_plan", AsyncMock(return_value=ENTERPRISE)
    )
    monkeypatch.setattr(throttling, "instance_plan", AsyncMock(return_value=ENTERPRISE))

    data = await entitlements_service._subscription_data(uuid4())

    assert data == {"plan": ENTERPRISE, "anchor": 7}
    assert await throttling._get_plan(str(uuid4())) == ENTERPRISE


@pytest.mark.asyncio
async def test_with_stripe_the_throttle_plan_is_the_cached_plan(cloud, monkeypatch):
    instance_plan = AsyncMock(return_value=COMMUNITY)
    monkeypatch.setattr(
        throttling, "get_cache", AsyncMock(return_value={"plan": "cloud_v0_pro"})
    )
    monkeypatch.setattr(throttling, "instance_plan", instance_plan)

    assert await throttling._get_plan(str(uuid4())) == "cloud_v0_pro"
    instance_plan.assert_not_awaited()


def _flags(plans, slug):
    return plans[slug][Tracker.FLAGS]


@pytest.mark.parametrize("slug", [COMMUNITY, REGISTERED])
def test_the_free_self_hosted_plans_have_no_enterprise_flag(self_hosted, slug):
    plans, _, _ = build_plan_controls()

    assert all(value is False for value in _flags(plans, slug).values())
    assert set(_flags(plans, slug)) == set(Flag)


def test_the_registered_plan_gives_the_community_entitlements(self_hosted):
    plans, _, _ = build_plan_controls()

    assert plans[REGISTERED] == plans[COMMUNITY]


def test_default_plan_and_overlay_cannot_unlock_enterprise_without_a_key(
    self_hosted, monkeypatch
):
    monkeypatch.setattr(env.agenta.access, "default_plan", COMMUNITY)
    monkeypatch.setattr(
        env.agenta.access,
        "default_plan_overlay",
        {"flags": {flag.value: True for flag in Flag}},
    )

    plans, _, _ = build_plan_controls()

    assert all(value is False for value in _flags(plans, COMMUNITY).values())


def test_access_plans_cannot_unlock_the_free_self_hosted_plans(
    self_hosted, monkeypatch
):
    all_on = {flag.value: True for flag in Flag}
    monkeypatch.setattr(
        env.agenta.access,
        "plans",
        {COMMUNITY: {"flags": all_on}, ENTERPRISE: {"flags": all_on}},
    )

    plans, _, _ = build_plan_controls()

    assert all(value is False for value in _flags(plans, COMMUNITY).values())
    # A plan that only a license key gives keeps what the operator set.
    assert all(_flags(plans, ENTERPRISE).values())
    # Missing from the env plan map, so the code table fills it in.
    assert all(value is False for value in _flags(plans, REGISTERED).values())


@pytest.mark.asyncio
async def test_default_plan_without_a_key_keeps_the_instance_on_community(
    self_hosted, monkeypatch
):
    # `AGENTA_ACCESS_DEFAULT_PLAN` only names the stored plan of new organizations;
    # without Stripe and without a key the resolved plan is the community plan.
    monkeypatch.setattr(env.agenta.access, "default_plan", ENTERPRISE)
    monkeypatch.setattr(
        subscriptions_service_module,
        "instance_plan",
        AsyncMock(return_value=COMMUNITY),
    )
    service = _subscriptions(ENTERPRISE)

    subscription = await service.read(organization_id=str(uuid4()))
    plans, _, _ = build_plan_controls()

    assert subscription.plan == COMMUNITY
    assert all(value is False for value in _flags(plans, subscription.plan).values())


def test_with_stripe_the_overlay_still_applies(cloud, monkeypatch):
    monkeypatch.setattr(env.agenta.access, "default_plan", "cloud_v0_pro")
    monkeypatch.setattr(
        env.agenta.access, "default_plan_overlay", {"flags": {"sso": True}}
    )

    plans, _, _ = build_plan_controls()

    assert _flags(plans, "cloud_v0_pro")[Flag.SSO] is True
