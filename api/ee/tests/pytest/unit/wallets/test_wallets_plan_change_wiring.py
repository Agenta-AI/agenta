"""Unit tests for the B2 wiring: `SubscriptionsService.process_event` must call the
wallet plan-change hook exactly when the subscription's plan actually changes, and must
never let a wallet-side failure propagate out of the billing-webhook boundary. The
proration arithmetic itself is tested in `test_wallets_proration.py`, and the DAO-level
replay/idempotency/immutability behavior in `test_wallets_provisioning.py` — this file
only covers the subscriptions-service call site.
"""

from datetime import datetime, timezone
from unittest.mock import MagicMock
from uuid import uuid4

import pytest

import ee.src.core.subscriptions.service as subscriptions_service_module
from ee.src.core.subscriptions.service import SubscriptionsService
from ee.src.core.subscriptions.types import Event, SubscriptionDTO
from oss.src.utils.env import env


@pytest.fixture(autouse=True)
def _wallets_enabled(monkeypatch):
    """The wallet ships behind AGENTA_WALLETS_ENABLED, default off; every call site
    guarded by it is a no-op otherwise. These tests cover the flag-on behaviour."""
    monkeypatch.setattr(env.wallets, "enabled", True)


class _FakeSubscriptionsDAO:
    """Minimal `SubscriptionsDAOInterface`-shaped fake — no Postgres."""

    def __init__(self, subscription: SubscriptionDTO):
        self._subscription = subscription

    async def create(self, *, subscription):
        self._subscription = subscription
        return subscription

    async def read(self, *, organization_id):
        return self._subscription

    async def update(self, *, subscription):
        self._subscription = subscription
        return subscription


class _RecordingWalletsService:
    def __init__(self, *, raises: bool = False):
        self.calls = []
        self.raises = raises

    async def apply_plan_change(self, **kwargs):
        self.calls.append(kwargs)
        if self.raises:
            raise RuntimeError("simulated wallet-side failure")


@pytest.mark.asyncio
async def test_process_event_calls_wallet_hook_when_plan_changes(monkeypatch):
    organization_id = str(uuid4())
    subscription = SubscriptionDTO(
        organization_id=organization_id, plan="cloud_v0_hobby", active=True, anchor=1
    )
    service = SubscriptionsService(
        subscriptions_dao=_FakeSubscriptionsDAO(subscription)
    )

    fake_wallets = _RecordingWalletsService()
    monkeypatch.setattr(
        subscriptions_service_module, "get_wallets_service", lambda: fake_wallets
    )

    await service.process_event(
        organization_id=organization_id,
        event=Event.SUBSCRIPTION_CREATED,
        subscription_id="sub_123",
        plan="cloud_v0_pro",
        anchor=1,
    )

    assert len(fake_wallets.calls) == 1
    call = fake_wallets.calls[0]
    assert call["outgoing_plan"] == "cloud_v0_hobby"
    assert call["incoming_plan"] == "cloud_v0_pro"
    assert str(call["organization_id"]) == organization_id
    assert call["idempotency_key"]  # non-empty, deterministic per change identity


@pytest.mark.asyncio
async def test_process_event_skips_wallet_hook_when_plan_is_unchanged(monkeypatch):
    organization_id = str(uuid4())
    subscription = SubscriptionDTO(
        organization_id=organization_id, plan="cloud_v0_pro", active=True, anchor=1
    )
    service = SubscriptionsService(
        subscriptions_dao=_FakeSubscriptionsDAO(subscription)
    )

    fake_wallets = _RecordingWalletsService()
    monkeypatch.setattr(
        subscriptions_service_module, "get_wallets_service", lambda: fake_wallets
    )

    await service.process_event(
        organization_id=organization_id,
        event=Event.SUBSCRIPTION_CREATED,
        subscription_id="sub_123",
        plan="cloud_v0_pro",  # same plan as before
        anchor=1,
    )

    assert fake_wallets.calls == []


@pytest.mark.asyncio
async def test_process_event_swallows_wallet_hook_failure(monkeypatch):
    """A wallet-side bug must not block Stripe webhook acknowledgement — process_event
    still returns the updated subscription even when the wallet hook raises."""
    organization_id = str(uuid4())
    subscription = SubscriptionDTO(
        organization_id=organization_id, plan="cloud_v0_hobby", active=True, anchor=1
    )
    service = SubscriptionsService(
        subscriptions_dao=_FakeSubscriptionsDAO(subscription)
    )

    fake_wallets = _RecordingWalletsService(raises=True)
    monkeypatch.setattr(
        subscriptions_service_module, "get_wallets_service", lambda: fake_wallets
    )

    result = await service.process_event(
        organization_id=organization_id,
        event=Event.SUBSCRIPTION_CREATED,
        subscription_id="sub_123",
        plan="cloud_v0_pro",
        anchor=1,
    )

    assert result.plan == "cloud_v0_pro"
    assert len(fake_wallets.calls) == 1


def _freeze_clock(monkeypatch, moment: datetime) -> None:
    """`process_event` reads the wall clock itself; pin it so the billing window the
    wallet hook receives can be asserted as exact dates."""

    class _FrozenDatetime(datetime):
        @classmethod
        def now(cls, tz=None):
            return moment if tz is None else moment.astimezone(tz)

    monkeypatch.setattr(subscriptions_service_module, "datetime", _FrozenDatetime)


@pytest.mark.asyncio
async def test_cancellation_prorates_over_the_period_the_paid_plan_was_billed_for(
    monkeypatch,
):
    """A cancellation on 25 March for a subscription anchored on the 10th must prorate
    the outgoing paid allowance over 10 March -> 10 April, the period that allowance was
    granted for. The branch overwrites `subscription.anchor` with today's day-of-month
    before the hook runs, so reading the post-mutation anchor produced 25 March ->
    25 April: a window starting today, which claws back almost the whole allowance no
    matter how much of the period the customer actually used."""
    organization_id = str(uuid4())
    subscription = SubscriptionDTO(
        organization_id=organization_id,
        subscription_id="sub_123",
        plan="cloud_v0_pro",
        active=True,
        anchor=10,
    )
    service = SubscriptionsService(
        subscriptions_dao=_FakeSubscriptionsDAO(subscription)
    )

    fake_wallets = _RecordingWalletsService()
    monkeypatch.setattr(
        subscriptions_service_module, "get_wallets_service", lambda: fake_wallets
    )
    _freeze_clock(monkeypatch, datetime(2026, 3, 25, 9, 0, tzinfo=timezone.utc))

    result = await service.process_event(
        organization_id=organization_id,
        event=Event.SUBSCRIPTION_CANCELLED,
    )

    assert result.plan == "cloud_v0_hobby"
    assert result.anchor == 25  # the subscription itself still re-anchors to today
    assert len(fake_wallets.calls) == 1
    call = fake_wallets.calls[0]
    assert call["outgoing_plan"] == "cloud_v0_pro"
    assert call["incoming_plan"] == "cloud_v0_hobby"
    assert call["outgoing_period_start"] == datetime(2026, 3, 10, tzinfo=timezone.utc)
    assert call["outgoing_period_end"] == datetime(2026, 4, 10, tzinfo=timezone.utc)
    # The incoming (free) allowance belongs to the period the subscription now carries.
    assert call["incoming_period_start"] == datetime(2026, 3, 25, tzinfo=timezone.utc)
    assert call["incoming_period_end"] == datetime(2026, 4, 25, tzinfo=timezone.utc)
    assert call["now"] == datetime(2026, 3, 25, 9, 0, tzinfo=timezone.utc)
    # The key names the INCOMING period: the one still reconstructible from the
    # subscription after this event overwrote its anchor.
    assert call["idempotency_key"] == "plan_change:none:2026-03-25T00:00:00+00:00"


@pytest.mark.asyncio
async def test_creation_grants_over_stripes_new_anchor_not_the_old_one(monkeypatch):
    """The other half of the same rule. On a new subscription the webhook supplies
    Stripe's real `billing_cycle_anchor` (billing router), and that is the period the new
    allowance will cover — so the incoming grant is sized and expired against it, while
    only the outgoing clawback still uses the old anchor.

    Upgrading on 14 March with an old anchor of 15 and a new anchor of 14: prorating the
    incoming grant over the outgoing window (15 February -> 15 March) would have been
    worth 12 hours of a period ending tomorrow instead of the full month starting today.
    """
    organization_id = str(uuid4())
    subscription = SubscriptionDTO(
        organization_id=organization_id,
        plan="cloud_v0_hobby",
        active=True,
        anchor=15,
    )
    service = SubscriptionsService(
        subscriptions_dao=_FakeSubscriptionsDAO(subscription)
    )

    fake_wallets = _RecordingWalletsService()
    monkeypatch.setattr(
        subscriptions_service_module, "get_wallets_service", lambda: fake_wallets
    )
    _freeze_clock(monkeypatch, datetime(2026, 3, 14, 12, 0, tzinfo=timezone.utc))

    result = await service.process_event(
        organization_id=organization_id,
        event=Event.SUBSCRIPTION_CREATED,
        subscription_id="sub_123",
        plan="cloud_v0_pro",
        anchor=14,  # Stripe's billing_cycle_anchor day, from the webhook
    )

    assert result.anchor == 14
    call = fake_wallets.calls[0]
    assert call["outgoing_period_start"] == datetime(2026, 2, 15, tzinfo=timezone.utc)
    assert call["outgoing_period_end"] == datetime(2026, 3, 15, tzinfo=timezone.utc)
    assert call["incoming_period_start"] == datetime(2026, 3, 14, tzinfo=timezone.utc)
    assert call["incoming_period_end"] == datetime(2026, 4, 14, tzinfo=timezone.utc)
    assert call["idempotency_key"] == "plan_change:sub_123:2026-03-14T00:00:00+00:00"


@pytest.mark.asyncio
async def test_switch_leaves_the_anchor_alone_so_both_windows_are_the_same_window(
    monkeypatch,
):
    """The invariant that makes the split safe: `SUBSCRIPTION_SWITCHED` never touches
    `subscription.anchor`, so the outgoing and incoming windows are identical and the
    proration is exactly what a single window produced."""
    organization_id = str(uuid4())
    subscription = SubscriptionDTO(
        organization_id=organization_id,
        subscription_id="sub_123",
        plan="cloud_v0_pro",
        active=True,
        anchor=8,
    )
    service = SubscriptionsService(
        subscriptions_dao=_FakeSubscriptionsDAO(subscription)
    )

    fake_wallets = _RecordingWalletsService()
    monkeypatch.setattr(
        subscriptions_service_module, "get_wallets_service", lambda: fake_wallets
    )
    stripe = MagicMock()
    stripe.SubscriptionItem.list.return_value.data = []
    monkeypatch.setattr(subscriptions_service_module, "_load_stripe", lambda: stripe)
    monkeypatch.setattr(
        subscriptions_service_module, "get_stripe_line_items", lambda plan: []
    )
    _freeze_clock(monkeypatch, datetime(2026, 3, 25, 9, 0, tzinfo=timezone.utc))

    result = await service.process_event(
        organization_id=organization_id,
        event=Event.SUBSCRIPTION_SWITCHED,
        plan="cloud_v0_business",
    )

    assert result.anchor == 8  # untouched by the switch
    call = fake_wallets.calls[0]
    assert call["outgoing_period_start"] == call["incoming_period_start"]
    assert call["outgoing_period_end"] == call["incoming_period_end"]
    assert call["outgoing_period_start"] == datetime(2026, 3, 8, tzinfo=timezone.utc)
    assert call["outgoing_period_end"] == datetime(2026, 4, 8, tzinfo=timezone.utc)
    assert call["idempotency_key"] == "plan_change:sub_123:2026-03-08T00:00:00+00:00"
