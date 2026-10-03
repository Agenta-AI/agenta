from types import SimpleNamespace
from unittest.mock import AsyncMock
from uuid import uuid4

import pytest
from fastapi import HTTPException

from ee.src.apis.fastapi.billing import router as billing_router_module
from ee.src.apis.fastapi.billing.router import BillingRouter
from ee.src.core.access.entitlements.types import DefaultPlan
from ee.src.core.subscriptions import service as subscriptions_service_module
from ee.src.core.subscriptions.service import SubscriptionsService
from ee.src.core.subscriptions.types import SubscriptionDTO

HOBBY = DefaultPlan.CLOUD_V0_HOBBY.value
PRO = DefaultPlan.CLOUD_V0_PRO.value
BUSINESS = DefaultPlan.CLOUD_V0_BUSINESS.value

LINE_ITEMS = {
    PRO: [{"price": "price_pro", "quantity": 1}],
    BUSINESS: [{"price": "price_business", "quantity": 1}],
}


class FakeStripeError(Exception):
    pass


class FakeStripe:
    """Keeps one subscription's items and rejects what real Stripe rejects."""

    def __init__(self, subscription_id: str, prices: list[str]):
        self.subscription_id = subscription_id
        self.status = "active"
        self.items = [
            {"id": f"si_{index}", "price": price} for index, price in enumerate(prices)
        ]
        self.cancelled = []
        self.modified = []

        stripe = self

        class Subscription:
            @staticmethod
            def retrieve(id):
                stripe._check(id)
                return SimpleNamespace(id=id, status=stripe.status)

            @staticmethod
            def cancel(id):
                stripe._check(id)
                stripe.status = "canceled"
                stripe.cancelled.append(id)

            @staticmethod
            def modify(id, items):
                stripe._check(id)
                deleted = {item["id"] for item in items if item.get("deleted")}
                kept = [item for item in stripe.items if item["id"] not in deleted]
                added = [item for item in items if not item.get("deleted")]
                if not kept + added:
                    raise FakeStripeError(
                        "A subscription must have at least one active plan."
                    )
                stripe.items = kept + added
                stripe.modified.append(id)

        class SubscriptionItem:
            @staticmethod
            def list(subscription):
                stripe._check(subscription)
                return SimpleNamespace(
                    data=[SimpleNamespace(id=item["id"]) for item in stripe.items]
                )

        self.Subscription = Subscription
        self.SubscriptionItem = SubscriptionItem

    def _check(self, id):
        if id != self.subscription_id:
            raise FakeStripeError(f"No such subscription: {id}")


class InMemorySubscriptionsDAO:
    def __init__(self, subscription: SubscriptionDTO):
        self.subscription = subscription

    async def create(self, *, subscription):
        self.subscription = subscription
        return subscription

    async def read(self, *, organization_id):
        if str(self.subscription.organization_id) != str(organization_id):
            return None
        return self.subscription.model_copy()

    async def update(self, *, subscription):
        self.subscription = subscription.model_copy()
        return subscription


def _setup(monkeypatch, *, plan, subscription_id, prices):
    organization_id = uuid4()
    dao = InMemorySubscriptionsDAO(
        SubscriptionDTO(
            organization_id=organization_id,
            customer_id="cus_123",
            subscription_id=subscription_id,
            plan=plan,
            active=True,
            anchor=1,
        )
    )
    stripe = FakeStripe(subscription_id or "sub_none", prices)

    monkeypatch.setattr(billing_router_module, "_load_stripe", lambda: stripe)
    monkeypatch.setattr(subscriptions_service_module, "_load_stripe", lambda: stripe)
    monkeypatch.setattr(subscriptions_service_module, "get_free_plan", lambda: HOBBY)
    monkeypatch.setattr(billing_router_module, "get_free_plan", lambda: HOBBY)
    monkeypatch.setattr(
        subscriptions_service_module,
        "get_stripe_line_items",
        lambda slug: [dict(item) for item in LINE_ITEMS.get(slug, [])],
    )

    router = BillingRouter(
        subscription_service=SubscriptionsService(subscriptions_dao=dao),
        meters_service=SimpleNamespace(),
    )
    router._reset_organization_flags = AsyncMock()

    return router, dao, stripe, str(organization_id)


@pytest.mark.asyncio
async def test_switch_from_paid_to_free_plan_cancels_the_stripe_subscription(
    monkeypatch,
):
    # Regression: this switch used to edit the subscription down to zero items,
    # which Stripe rejects, and the route answered 500.
    router, dao, stripe, organization_id = _setup(
        monkeypatch, plan=PRO, subscription_id="sub_123", prices=["price_pro"]
    )

    response = await router.switch_plans(organization_id=organization_id, plan=HOBBY)

    assert response.status_code == 200
    assert stripe.cancelled == ["sub_123"]
    assert stripe.modified == []
    assert dao.subscription.plan == HOBBY
    assert dao.subscription.subscription_id is None
    assert dao.subscription.active is True
    router._reset_organization_flags.assert_awaited_once_with(organization_id)


@pytest.mark.asyncio
async def test_switch_between_paid_plans_replaces_the_stripe_items(monkeypatch):
    router, dao, stripe, organization_id = _setup(
        monkeypatch, plan=PRO, subscription_id="sub_123", prices=["price_pro"]
    )

    response = await router.switch_plans(organization_id=organization_id, plan=BUSINESS)

    assert response.status_code == 200
    assert stripe.modified == ["sub_123"]
    assert stripe.cancelled == []
    assert [item["price"] for item in stripe.items] == ["price_business"]
    assert dao.subscription.plan == BUSINESS
    assert dao.subscription.subscription_id == "sub_123"
    router._reset_organization_flags.assert_not_awaited()


@pytest.mark.asyncio
async def test_switch_from_free_plan_to_paid_plan_is_refused(monkeypatch):
    # Upgrades go through Checkout; the switch route keeps refusing them.
    router, dao, stripe, organization_id = _setup(
        monkeypatch, plan=HOBBY, subscription_id=None, prices=[]
    )

    with pytest.raises(HTTPException) as error:
        await router.switch_plans(organization_id=organization_id, plan=PRO)

    assert error.value.status_code == 400
    assert stripe.modified == []
    assert stripe.cancelled == []
    assert dao.subscription.plan == HOBBY


@pytest.mark.asyncio
async def test_switch_to_paid_plan_without_stripe_prices_is_refused(monkeypatch):
    router, dao, stripe, organization_id = _setup(
        monkeypatch, plan=PRO, subscription_id="sub_123", prices=["price_pro"]
    )
    monkeypatch.setitem(LINE_ITEMS, BUSINESS, [])

    with pytest.raises(HTTPException) as error:
        await router.switch_plans(organization_id=organization_id, plan=BUSINESS)

    assert error.value.status_code == 400
    assert "no Stripe prices" in error.value.detail
    assert stripe.modified == []
    assert [item["price"] for item in stripe.items] == ["price_pro"]
    assert dao.subscription.plan == PRO


@pytest.mark.asyncio
async def test_switch_refused_by_stripe_answers_400_and_keeps_the_plan(monkeypatch):
    router, dao, stripe, organization_id = _setup(
        monkeypatch, plan=PRO, subscription_id="sub_123", prices=["price_pro"]
    )

    def refuse(id, items):
        raise FakeStripeError("This subscription cannot be updated.")

    monkeypatch.setattr(stripe.Subscription, "modify", staticmethod(refuse))

    with pytest.raises(HTTPException) as error:
        await router.switch_plans(organization_id=organization_id, plan=BUSINESS)

    assert error.value.status_code == 400
    assert dao.subscription.plan == PRO
    assert [item["price"] for item in stripe.items] == ["price_pro"]
