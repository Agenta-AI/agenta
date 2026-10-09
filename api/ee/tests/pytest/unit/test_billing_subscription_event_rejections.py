"""Why `process_event` refuses an event, and whether it says so.

An `invoice.payment_failed` delivery reached the terminal branch of
`process_event`, which logged the subscription object alone: no event, no
organization, no plan. These tests pin what each rejection now records.
"""

from uuid import uuid4

import pytest

from ee.src.core.access.entitlements.types import DefaultPlan
from ee.src.core.subscriptions import service as subscriptions_service_module
from ee.src.core.subscriptions.service import EventException, SubscriptionsService
from ee.src.core.subscriptions.types import Event, SubscriptionDTO

HOBBY = DefaultPlan.CLOUD_V0_HOBBY.value
PRO = DefaultPlan.CLOUD_V0_PRO.value


class _DAO:
    def __init__(self, subscription):
        self.subscription = subscription

    async def read(self, *, organization_id):
        if self.subscription is None:
            return None
        return self.subscription.model_copy()

    async def update(self, *, subscription):
        self.subscription = subscription.model_copy()
        return subscription


@pytest.fixture
def warnings(monkeypatch):
    recorded = []
    monkeypatch.setattr(
        subscriptions_service_module.log,
        "warn",
        lambda message, *args, **kwargs: recorded.append(message % args),
    )
    monkeypatch.setattr(subscriptions_service_module, "get_free_plan", lambda: HOBBY)
    monkeypatch.setattr(
        subscriptions_service_module,
        "invalidate_cache",
        _noop_invalidate,
    )
    return recorded


async def _noop_invalidate(**_kwargs):
    return None


def _service(plan, *, organization_id, missing=False):
    subscription = (
        None
        if missing
        else SubscriptionDTO(
            organization_id=organization_id,
            customer_id="cus_123",
            subscription_id="sub_123",
            plan=plan,
            active=True,
            anchor=1,
        )
    )
    return SubscriptionsService(subscriptions_dao=_DAO(subscription))


@pytest.mark.asyncio
async def test_pausing_a_paid_subscription_deactivates_it(warnings):
    organization_id = uuid4()
    service = _service(PRO, organization_id=organization_id)

    subscription = await service.process_event(
        organization_id=str(organization_id),
        event=Event.SUBSCRIPTION_PAUSED,
    )

    assert subscription.active is False
    assert warnings == []


@pytest.mark.asyncio
async def test_pausing_a_free_plan_is_refused_and_names_the_plan(warnings):
    # The state the reported invoice.payment_failed delivery reached: every
    # branch is guarded by `plan != free_plan`, so the terminal one answers.
    organization_id = uuid4()
    service = _service(HOBBY, organization_id=organization_id)

    with pytest.raises(EventException) as caught:
        await service.process_event(
            organization_id=str(organization_id),
            event=Event.SUBSCRIPTION_PAUSED,
        )

    assert "subscription_paused" in str(caught.value)
    assert str(organization_id) in str(caught.value)
    assert HOBBY in str(caught.value)

    assert len(warnings) == 1
    assert "unhandled subscription event" in warnings[0]
    assert str(organization_id) in warnings[0]
    assert "subscription_paused" in warnings[0]
    assert f"plan={HOBBY}" in warnings[0]


@pytest.mark.asyncio
async def test_an_unset_plan_still_takes_the_pause_branch(warnings):
    # `plan != free_plan` holds for None, so an unset plan is NOT what reaches
    # the terminal branch. Only the free plan itself does.
    organization_id = uuid4()
    service = _service(None, organization_id=organization_id)

    subscription = await service.process_event(
        organization_id=str(organization_id),
        event=Event.SUBSCRIPTION_PAUSED,
    )

    assert subscription.active is False
    assert warnings == []


@pytest.mark.asyncio
async def test_resuming_a_free_plan_is_refused_too(warnings):
    organization_id = uuid4()
    service = _service(HOBBY, organization_id=organization_id)

    with pytest.raises(EventException, match="subscription_resumed"):
        await service.process_event(
            organization_id=str(organization_id),
            event=Event.SUBSCRIPTION_RESUMED,
        )

    assert "unhandled subscription event" in warnings[0]


@pytest.mark.asyncio
async def test_a_missing_subscription_row_is_refused_and_logged(warnings):
    # This message used to render the literal "{organization_id}": the f prefix
    # was missing, so the one identifier a reader needed was never in it.
    organization_id = uuid4()
    service = _service(PRO, organization_id=organization_id, missing=True)

    with pytest.raises(EventException) as caught:
        await service.process_event(
            organization_id=str(organization_id),
            event=Event.SUBSCRIPTION_PAUSED,
        )

    assert "{organization_id}" not in str(caught.value)
    assert str(organization_id) in str(caught.value)
    assert "subscription_paused" in str(caught.value)

    assert len(warnings) == 1
    assert "no subscription row" in warnings[0]
    assert str(organization_id) in warnings[0]


@pytest.mark.asyncio
async def test_cancelling_an_already_free_plan_stays_a_no_op(warnings):
    # The one combination that was already tolerated. It must not become a
    # rejection.
    organization_id = uuid4()
    service = _service(HOBBY, organization_id=organization_id)

    subscription = await service.process_event(
        organization_id=str(organization_id),
        event=Event.SUBSCRIPTION_CANCELLED,
    )

    assert subscription.plan == HOBBY
    assert warnings == []
