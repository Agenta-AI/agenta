"""Stripe subscription events delivered out of order, end to end through the webhook.

Stripe does not guarantee delivery order and retries a failed delivery for days, so
an event can arrive after the organization's subscription has changed. Each event
must apply only to the subscription the row records. The payloads below follow the
shapes production receives (Stripe API version 2023-10-16), anonymized, plus the
newer invoice shape where only `parent` holds the subscription.
"""

from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest

from ee.src.apis.fastapi.billing import router as billing_router_module
from ee.src.apis.fastapi.billing.router import BillingRouter
from ee.src.core.access.entitlements.types import DefaultPlan
from ee.src.core.subscriptions import service as subscriptions_service_module
from ee.src.core.subscriptions.service import SubscriptionsService
from ee.src.core.subscriptions.types import Event, SubscriptionDTO

HOBBY = DefaultPlan.CLOUD_V0_HOBBY.value
PRO = DefaultPlan.CLOUD_V0_PRO.value
BUSINESS = DefaultPlan.CLOUD_V0_BUSINESS.value
ORGANIZATION_ID = "00000000-0000-7000-8000-000000000001"
ANCHOR = 1791000000  # a billing_cycle_anchor timestamp


class _DAO:
    def __init__(self, subscription):
        self.subscription = subscription
        self.writes = 0

    async def read(self, *, organization_id):
        return self.subscription.model_copy()

    async def update(
        self,
        *,
        subscription,
        check_subscription_id=False,
        expected_subscription_id=None,
    ):
        if (
            check_subscription_id
            and self.subscription.subscription_id != expected_subscription_id
        ):
            return None
        self.writes += 1
        self.subscription = subscription.model_copy()
        return subscription


class _Stripe:
    """Stands in for the Stripe client: the webhook's event and the live status of
    each subscription."""

    def __init__(self):
        self.statuses = {}
        self.event = None
        self.unreadable = False
        self.Event = SimpleNamespace(construct_from=lambda payload, api_key: self.event)
        self.Subscription = SimpleNamespace(
            retrieve=self._retrieve,
            modify=lambda *args, **kwargs: None,
        )
        self.SubscriptionItem = SimpleNamespace(
            list=lambda **kwargs: SimpleNamespace(data=[])
        )
        self.api_key = "sk_test_123"

    def _retrieve(self, subscription_id):
        if self.unreadable:
            raise RuntimeError("stripe is down")
        return SimpleNamespace(
            id=subscription_id, status=self.statuses[subscription_id]
        )


def _metadata(plan=PRO):
    return SimpleNamespace(
        organization_id=ORGANIZATION_ID,
        plan=plan,
        target=billing_router_module.env.stripe.webhook_target,
    )


def _subscription_event(kind, subscription_id, status, plan=PRO):
    return SimpleNamespace(
        id=f"evt_{kind}_{subscription_id}",
        type=f"customer.subscription.{kind}",
        data=SimpleNamespace(
            object=SimpleNamespace(
                id=subscription_id,
                object="subscription",
                status=status,
                customer="cus_123",
                billing_cycle_anchor=ANCHOR,
                metadata=_metadata(plan),
            )
        ),
    )


def _invoice_event(kind, subscription_id, shape="2023-10-16", plan=PRO):
    parent = SimpleNamespace(
        type="subscription_details",
        subscription_details=SimpleNamespace(
            subscription=subscription_id,
            metadata=_metadata(plan),
        ),
    )
    if shape == "2023-10-16-without-parent":
        invoice = SimpleNamespace(
            id=f"in_{subscription_id}",
            billing_reason="subscription_cycle",
            subscription=subscription_id,
            subscription_details=SimpleNamespace(metadata=_metadata(plan)),
            total=0,
        )
    elif shape == "2023-10-16":
        invoice = SimpleNamespace(
            id=f"in_{subscription_id}",
            billing_reason="subscription_cycle",
            subscription=subscription_id,
            subscription_details=SimpleNamespace(metadata=_metadata(plan)),
            parent=parent,
            total=0,
        )
    else:
        invoice = SimpleNamespace(
            id=f"in_{subscription_id}",
            billing_reason="subscription_cycle",
            parent=parent,
            total=0,
        )
    return SimpleNamespace(
        id=f"evt_{kind}_{subscription_id}",
        type=f"invoice.{kind}",
        data=SimpleNamespace(object=invoice),
    )


class DummyRequest:
    headers = {}

    async def body(self):
        return b"{}"


@pytest.fixture
def stripe(monkeypatch):
    client = _Stripe()
    monkeypatch.setattr(billing_router_module.env.stripe, "api_key", "sk_test_123")
    monkeypatch.setattr(billing_router_module.env.stripe, "webhook_secret", None)
    # Unsigned events with the wallet on would grant period credits, which need a signature.
    monkeypatch.setattr(billing_router_module.env.wallets, "enabled", False)
    monkeypatch.setattr(billing_router_module, "_load_stripe", lambda: client)
    monkeypatch.setattr(subscriptions_service_module, "_load_stripe", lambda: client)
    monkeypatch.setattr(subscriptions_service_module, "get_free_plan", lambda: HOBBY)
    monkeypatch.setattr(
        subscriptions_service_module,
        "get_stripe_line_items",
        lambda plan: [{"price": f"price_{plan}"}],
    )
    monkeypatch.setattr(
        billing_router_module,
        "get_plans",
        lambda: {HOBBY: {}, PRO: {}, BUSINESS: {}},
    )

    async def _noop(**_kwargs):
        return None

    monkeypatch.setattr(subscriptions_service_module, "invalidate_cache", _noop)
    return client


def _setup(row):
    dao = _DAO(row)
    router = BillingRouter(
        subscription_service=SubscriptionsService(subscriptions_dao=dao),
        meters_service=SimpleNamespace(),
    )
    router._reset_organization_flags = AsyncMock()
    return dao, router


async def _deliver(router, stripe, event):
    stripe.event = event
    return await router.handle_events(DummyRequest())


def _row(plan=HOBBY, subscription_id=None, active=True):
    return SubscriptionDTO(
        organization_id=ORGANIZATION_ID,
        customer_id="cus_123",
        subscription_id=subscription_id,
        plan=plan,
        active=active,
        anchor=1,
    )


# --- The orderings that used to leave the row wrong --------------------------------


@pytest.mark.asyncio
async def test_a_late_deletion_of_an_earlier_subscription_keeps_the_new_one(stripe):
    # Subscribe, cancel, subscribe again. The first subscription's deletion is
    # redelivered after the second one is recorded.
    stripe.statuses = {"sub_old": "canceled", "sub_new": "active"}
    dao, router = _setup(_row(plan=PRO, subscription_id="sub_new"))

    response = await _deliver(
        router, stripe, _subscription_event("deleted", "sub_old", "canceled")
    )

    assert response.status_code == 200
    assert dao.subscription.plan == PRO
    assert dao.subscription.subscription_id == "sub_new"
    assert dao.subscription.active is True
    assert dao.writes == 0
    router._reset_organization_flags.assert_not_awaited()


@pytest.mark.asyncio
async def test_a_late_creation_after_the_deletion_does_not_reactivate(stripe):
    # The deletion was processed first, then the creation of the same, now ended,
    # subscription arrives.
    stripe.statuses = {"sub_old": "canceled"}
    dao, router = _setup(_row())

    response = await _deliver(
        router, stripe, _subscription_event("created", "sub_old", "active")
    )

    assert response.status_code == 200
    assert dao.subscription.plan == HOBBY
    assert dao.subscription.subscription_id is None
    assert dao.writes == 0


@pytest.mark.asyncio
async def test_a_late_creation_of_an_earlier_subscription_keeps_the_new_one(stripe):
    stripe.statuses = {"sub_old": "canceled", "sub_new": "active"}
    dao, router = _setup(_row(plan=BUSINESS, subscription_id="sub_new"))

    response = await _deliver(
        router, stripe, _subscription_event("created", "sub_old", "active", plan=PRO)
    )

    assert response.status_code == 200
    assert dao.subscription.plan == BUSINESS
    assert dao.subscription.subscription_id == "sub_new"
    assert dao.writes == 0


@pytest.mark.asyncio
async def test_a_late_payment_for_an_earlier_subscription_changes_nothing(stripe):
    stripe.statuses = {"sub_old": "canceled", "sub_new": "active"}
    dao, router = _setup(_row(plan=PRO, subscription_id="sub_new", active=False))

    response = await _deliver(
        router, stripe, _invoice_event("payment_succeeded", "sub_old")
    )

    assert response.status_code == 200
    assert dao.subscription.active is False
    assert dao.writes == 0


@pytest.mark.asyncio
async def test_a_payment_failure_after_the_deletion_is_acknowledged(stripe):
    # #7495: Stripe ends a subscription when its last retry fails and sends both
    # events in the same second; the deletion was processed first.
    stripe.statuses = {"sub_1": "canceled"}
    dao, router = _setup(_row())

    response = await _deliver(router, stripe, _invoice_event("payment_failed", "sub_1"))

    assert response.status_code == 200
    assert dao.writes == 0


# --- Regression: the normal flows still apply ---------------------------------------


@pytest.mark.asyncio
async def test_subscribing_activates_the_paid_plan(stripe):
    stripe.statuses = {"sub_1": "active"}
    dao, router = _setup(_row())

    response = await _deliver(
        router, stripe, _subscription_event("created", "sub_1", "active")
    )

    assert response.status_code == 200
    assert dao.subscription.plan == PRO
    assert dao.subscription.subscription_id == "sub_1"
    assert dao.subscription.active is True


@pytest.mark.asyncio
async def test_subscribing_again_after_a_cancellation_activates_the_new_one(stripe):
    stripe.statuses = {"sub_old": "canceled", "sub_new": "active"}
    dao, router = _setup(_row(plan=PRO, subscription_id="sub_old"))

    await _deliver(
        router, stripe, _subscription_event("deleted", "sub_old", "canceled")
    )
    assert dao.subscription.plan == HOBBY
    router._reset_organization_flags.assert_awaited_once()

    response = await _deliver(
        router, stripe, _subscription_event("created", "sub_new", "active")
    )

    assert response.status_code == 200
    assert dao.subscription.plan == PRO
    assert dao.subscription.subscription_id == "sub_new"
    assert dao.subscription.active is True


@pytest.mark.asyncio
async def test_a_late_creation_is_refused_when_stripe_cannot_be_read(stripe):
    # The deletion was processed; the creation of the same subscription arrives and
    # Stripe cannot be read. Applying it on a guess would restore an ended
    # subscription, so it is refused and Stripe retries it.
    stripe.unreadable = True
    dao, router = _setup(_row())

    response = await _deliver(
        router, stripe, _subscription_event("created", "sub_old", "active")
    )

    assert response.status_code == 400
    assert dao.subscription.plan == HOBBY
    assert dao.subscription.subscription_id is None
    assert dao.writes == 0


@pytest.mark.asyncio
async def test_a_deletion_racing_a_new_subscription_does_not_erase_it(stripe):
    # deleted(old) reads the row while it records the old subscription; created(new)
    # commits before deleted(old) writes. The guarded write sees the change and
    # refuses, so Stripe retries the deletion, which is then stale.
    stripe.statuses = {"sub_old": "canceled", "sub_new": "active"}
    dao, router = _setup(_row(plan=PRO, subscription_id="sub_old"))
    read = dao.read

    async def read_then_new_subscription_commits(*, organization_id):
        row = await read(organization_id=organization_id)
        dao.subscription = _row(plan=BUSINESS, subscription_id="sub_new")
        return row

    dao.read = read_then_new_subscription_commits

    response = await _deliver(
        router, stripe, _subscription_event("deleted", "sub_old", "canceled")
    )

    assert response.status_code == 400
    assert dao.subscription.plan == BUSINESS
    assert dao.subscription.subscription_id == "sub_new"
    router._reset_organization_flags.assert_not_awaited()

    dao.read = read
    retry = await _deliver(
        router, stripe, _subscription_event("deleted", "sub_old", "canceled")
    )

    assert retry.status_code == 200
    assert dao.subscription.subscription_id == "sub_new"


@pytest.mark.asyncio
async def test_a_failure_for_a_new_subscription_before_its_creation_still_pauses(
    stripe,
):
    # The row records A; B's payment fails before B's CREATED is processed. The
    # failure is refused (not skipped), so the retry after CREATED pauses B.
    stripe.statuses = {"sub_a": "active", "sub_b": "past_due"}
    dao, router = _setup(_row(plan=PRO, subscription_id="sub_a"))

    first = await _deliver(router, stripe, _invoice_event("payment_failed", "sub_b"))
    assert first.status_code == 400

    await _deliver(router, stripe, _subscription_event("created", "sub_b", "past_due"))
    assert dao.subscription.subscription_id == "sub_b"

    retry = await _deliver(router, stripe, _invoice_event("payment_failed", "sub_b"))

    assert retry.status_code == 200
    assert dao.subscription.active is False


@pytest.mark.asyncio
async def test_a_trial_signup_recorded_before_its_creation_event_still_applies(stripe):
    # The reverse trial records the subscription id itself, before CREATED arrives.
    stripe.statuses = {"sub_trial": "trialing"}
    dao, router = _setup(_row(plan=PRO, subscription_id="sub_trial"))

    response = await _deliver(
        router, stripe, _subscription_event("created", "sub_trial", "trialing")
    )

    assert response.status_code == 200
    assert dao.subscription.subscription_id == "sub_trial"
    assert dao.subscription.active is True


@pytest.mark.asyncio
async def test_upgrading_keeps_the_subscription_and_its_events_apply(stripe):
    stripe.statuses = {"sub_1": "active"}
    dao, router = _setup(_row(plan=PRO, subscription_id="sub_1"))

    await router.subscription_service.process_event(
        organization_id=ORGANIZATION_ID,
        event=Event.SUBSCRIPTION_SWITCHED,
        plan=BUSINESS,
    )
    assert dao.subscription.plan == BUSINESS
    assert dao.subscription.subscription_id == "sub_1"

    response = await _deliver(
        router, stripe, _invoice_event("payment_failed", "sub_1", plan=BUSINESS)
    )

    assert response.status_code == 200
    assert dao.subscription.active is False


@pytest.mark.asyncio
async def test_cancelling_the_recorded_subscription_downgrades(stripe):
    stripe.statuses = {"sub_1": "canceled"}
    dao, router = _setup(_row(plan=PRO, subscription_id="sub_1"))

    response = await _deliver(
        router, stripe, _subscription_event("deleted", "sub_1", "canceled")
    )

    assert response.status_code == 200
    assert dao.subscription.plan == HOBBY
    assert dao.subscription.subscription_id is None
    router._reset_organization_flags.assert_awaited_once()


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "shape", ["2023-10-16", "2023-10-16-without-parent", "2025-03-31"]
)
async def test_a_failed_then_paid_invoice_pauses_then_resumes(stripe, shape):
    stripe.statuses = {"sub_1": "past_due"}
    dao, router = _setup(_row(plan=PRO, subscription_id="sub_1"))

    await _deliver(router, stripe, _invoice_event("payment_failed", "sub_1", shape))
    assert dao.subscription.active is False

    response = await _deliver(
        router, stripe, _invoice_event("payment_succeeded", "sub_1", shape)
    )

    assert response.status_code == 200
    assert dao.subscription.active is True


@pytest.mark.asyncio
async def test_a_failure_then_the_deletion_ends_on_the_free_plan(stripe):
    # The reverse of #7495's order.
    stripe.statuses = {"sub_1": "canceled"}
    dao, router = _setup(_row(plan=PRO, subscription_id="sub_1"))

    await _deliver(router, stripe, _invoice_event("payment_failed", "sub_1"))
    await _deliver(router, stripe, _subscription_event("deleted", "sub_1", "canceled"))

    assert dao.subscription.plan == HOBBY
    assert dao.subscription.subscription_id is None
    assert dao.subscription.active is True


@pytest.mark.asyncio
async def test_a_deletion_without_a_subscription_id_is_refused(stripe):
    dao, router = _setup(_row(plan=PRO, subscription_id="sub_1"))
    event = _subscription_event("deleted", "sub_1", "canceled")
    event.data.object.id = None

    response = await _deliver(router, stripe, event)

    assert response.status_code == 400
    assert dao.subscription.plan == PRO
    assert dao.subscription.subscription_id == "sub_1"
    router._reset_organization_flags.assert_not_awaited()
