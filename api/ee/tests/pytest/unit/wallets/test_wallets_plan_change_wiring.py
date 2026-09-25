"""Unit tests for the wiring between `SubscriptionsService.process_event` and the wallet
plan-change hook: when the hook runs, what it is given, how it is keyed, that a
wallet-side failure never escapes the billing boundary, and that subscription changes for
one organization are serialized around it. The proration arithmetic itself is tested in
`test_wallets_proration.py`, and the DAO-level behavior in `test_wallets_provisioning.py`
and the Postgres suites.
"""

import asyncio
from contextlib import asynccontextmanager
from datetime import datetime, timezone
from unittest.mock import MagicMock
from uuid import uuid4

import pytest

import ee.src.core.subscriptions.service as subscriptions_service_module
from ee.src.core.subscriptions.service import EventException, SubscriptionsService
from ee.src.core.subscriptions.types import Event, SubscriptionDTO
from ee.src.core.wallets.service import WalletsService
from ee.tests.pytest.utils.wallets.builders import build_general_wallet_balance
from ee.tests.pytest.utils.wallets.fakes import FakeWalletsDAO
from oss.src.utils.env import env

APRIL_START = datetime(2026, 4, 1, tzinfo=timezone.utc)
APRIL_END = datetime(2026, 5, 1, tzinfo=timezone.utc)  # 30 days


@pytest.fixture(autouse=True)
def _wallets_enabled(monkeypatch):
    """The wallet ships behind AGENTA_WALLETS_ENABLED, default off; every call site
    guarded by it is a no-op otherwise. These tests cover the flag-on behaviour unless
    they say otherwise."""
    monkeypatch.setattr(env.wallets, "enabled", True)


class _FakeSubscriptionsDAO:
    """`SubscriptionsDAOInterface`-shaped fake. `read` yields to the event loop, as a
    real database round trip does, so two concurrent `process_event` calls interleave
    unless the lock keeps them apart."""

    def __init__(self, subscription: SubscriptionDTO):
        self._subscription = subscription
        self._lock = asyncio.Lock()
        self.held = False

    @asynccontextmanager
    async def lock(self, *, organization_id):
        async with self._lock:
            self.held = True
            try:
                yield
            finally:
                self.held = False

    async def create(self, *, subscription):
        self._subscription = subscription
        return subscription

    async def read(self, *, organization_id):
        await asyncio.sleep(0)
        return self._subscription.model_copy()

    async def update(self, *, subscription):
        self._subscription = subscription.model_copy()
        return subscription


class _RecordingWalletsService:
    def __init__(self, *, raises: bool = False, dao: _FakeSubscriptionsDAO = None):
        self.calls = []
        self.raises = raises
        self.dao = dao
        self.held_during_call = []

    async def apply_plan_change(self, **kwargs):
        self.calls.append(kwargs)
        if self.dao is not None:
            self.held_during_call.append(self.dao.held)
        if self.raises:
            raise RuntimeError("simulated wallet-side failure")


def _stripe_subscription(period_start: datetime, period_end: datetime):
    item = MagicMock(
        current_period_start=int(period_start.timestamp()),
        current_period_end=int(period_end.timestamp()),
    )
    return MagicMock(items=MagicMock(data=[item]))


def _mock_stripe(monkeypatch, period=(APRIL_START, APRIL_END)):
    """The direct plan-switch route reads the subscription from Stripe, then modifies
    it, before it updates the row."""
    stripe = MagicMock()
    stripe.Subscription.retrieve.return_value = _stripe_subscription(*period)
    stripe.SubscriptionItem.list.return_value.data = []
    monkeypatch.setattr(subscriptions_service_module, "_load_stripe", lambda: stripe)
    monkeypatch.setattr(
        subscriptions_service_module, "get_stripe_line_items", lambda plan: []
    )
    return stripe


def _freeze_clock(monkeypatch, moment: datetime) -> None:
    class _FrozenDatetime(datetime):
        @classmethod
        def now(cls, tz=None):
            return moment if tz is None else moment.astimezone(tz)

    monkeypatch.setattr(subscriptions_service_module, "datetime", _FrozenDatetime)


def _service(subscription: SubscriptionDTO):
    dao = _FakeSubscriptionsDAO(subscription)
    return SubscriptionsService(subscriptions_dao=dao), dao


def _pro_subscription(organization_id: str) -> SubscriptionDTO:
    return SubscriptionDTO(
        organization_id=organization_id,
        subscription_id="sub_123",
        plan="cloud_v0_pro",
        active=True,
        anchor=1,
    )


@pytest.mark.asyncio
async def test_creation_passes_the_stripe_period_and_effective_time(monkeypatch):
    organization_id = str(uuid4())
    service, dao = _service(
        SubscriptionDTO(
            organization_id=organization_id,
            plan="cloud_v0_hobby",
            active=True,
            anchor=1,
        )
    )
    fake_wallets = _RecordingWalletsService(dao=dao)
    monkeypatch.setattr(service, "wallets_service", fake_wallets)
    effective_at = datetime(2026, 4, 1, 15, 30, tzinfo=timezone.utc)
    period_end = datetime(2026, 5, 1, 15, 30, tzinfo=timezone.utc)

    await service.process_event(
        organization_id=organization_id,
        event=Event.SUBSCRIPTION_CREATED,
        subscription_id="sub_123",
        plan="cloud_v0_pro",
        anchor=1,
        event_id="evt_created",
        effective_at=effective_at,
        period_start=effective_at,
        period_end=period_end,
    )

    assert fake_wallets.calls == [
        dict(
            organization_id=dao._subscription.organization_id,
            idempotency_key="plan_change:evt_created",
            subscription_id="sub_123",
            incoming_plan="cloud_v0_pro",
            period_start=effective_at,
            period_end=period_end,
            now=effective_at,
        )
    ]
    # The hook runs inside the organization's subscription lock.
    assert fake_wallets.held_during_call == [True]


@pytest.mark.asyncio
async def test_switch_reads_the_period_from_the_stripe_subscription(monkeypatch):
    organization_id = str(uuid4())
    service, _ = _service(_pro_subscription(organization_id))
    fake_wallets = _RecordingWalletsService()
    monkeypatch.setattr(service, "wallets_service", fake_wallets)
    period = (
        datetime(2026, 4, 1, 9, 12, tzinfo=timezone.utc),
        datetime(2026, 5, 1, 9, 12, tzinfo=timezone.utc),
    )
    _mock_stripe(monkeypatch, period=period)
    _freeze_clock(monkeypatch, datetime(2026, 4, 16, tzinfo=timezone.utc))

    result = await service.process_event(
        organization_id=organization_id,
        event=Event.SUBSCRIPTION_SWITCHED,
        plan="cloud_v0_business",
    )

    assert result.anchor == 1  # a switch never moves the anchor
    call = fake_wallets.calls[0]
    assert (call["period_start"], call["period_end"]) == period
    assert call["now"] == datetime(2026, 4, 16, tzinfo=timezone.utc)
    assert call["subscription_id"] == "sub_123"


@pytest.mark.asyncio
async def test_cancellation_passes_no_period_and_no_subscription(monkeypatch):
    """The free plan has no Stripe subscription and no allowance; the outgoing side is
    read off the outgoing credit, so a cancellation needs no period at all."""
    organization_id = str(uuid4())
    service, _ = _service(_pro_subscription(organization_id))
    fake_wallets = _RecordingWalletsService()
    monkeypatch.setattr(service, "wallets_service", fake_wallets)

    result = await service.process_event(
        organization_id=organization_id,
        event=Event.SUBSCRIPTION_CANCELLED,
    )

    assert result.plan == "cloud_v0_hobby"
    call = fake_wallets.calls[0]
    assert call["incoming_plan"] == "cloud_v0_hobby"
    assert call["subscription_id"] is None
    assert call["period_start"] is None and call["period_end"] is None


@pytest.mark.asyncio
async def test_process_event_skips_wallet_hook_when_plan_is_unchanged(monkeypatch):
    organization_id = str(uuid4())
    service, _ = _service(_pro_subscription(organization_id))
    fake_wallets = _RecordingWalletsService()
    monkeypatch.setattr(service, "wallets_service", fake_wallets)

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
    service, _ = _service(
        SubscriptionDTO(
            organization_id=organization_id, plan="cloud_v0_hobby", active=True
        )
    )
    fake_wallets = _RecordingWalletsService(raises=True)
    monkeypatch.setattr(service, "wallets_service", fake_wallets)

    result = await service.process_event(
        organization_id=organization_id,
        event=Event.SUBSCRIPTION_CREATED,
        subscription_id="sub_123",
        plan="cloud_v0_pro",
        anchor=1,
        period_start=APRIL_START,
        period_end=APRIL_END,
    )

    assert result.plan == "cloud_v0_pro"
    assert len(fake_wallets.calls) == 1


@pytest.mark.asyncio
async def test_flag_off_takes_no_lock_and_calls_no_hook(monkeypatch):
    monkeypatch.setattr(env.wallets, "enabled", False)
    organization_id = str(uuid4())
    service, dao = _service(
        SubscriptionDTO(
            organization_id=organization_id, plan="cloud_v0_hobby", active=True
        )
    )

    def _no_lock(**kwargs):
        raise AssertionError("the lock must not be taken with wallets disabled")

    dao.lock = _no_lock
    fake_wallets = _RecordingWalletsService()
    monkeypatch.setattr(service, "wallets_service", fake_wallets)

    result = await service.process_event(
        organization_id=organization_id,
        event=Event.SUBSCRIPTION_CREATED,
        subscription_id="sub_123",
        plan="cloud_v0_pro",
        anchor=1,
    )

    assert result.plan == "cloud_v0_pro"
    assert fake_wallets.calls == []


@pytest.mark.asyncio
async def test_direct_changes_get_a_fresh_key_so_a_repeated_transition_moves_money(
    monkeypatch,
):
    """Open-designs item 22's residue: Pro to Business, back to Pro, to Business again,
    all in one period, through the direct route. The third leg used to key identically
    to the first and move nothing. Each direct call is now its own occurrence."""
    organization_id = str(uuid4())
    service, _ = _service(_pro_subscription(organization_id))
    wallets_dao = FakeWalletsDAO(
        general_balance=build_general_wallet_balance(balance_musd=0, floor_musd=0)
    )
    monkeypatch.setattr(
        service, "wallets_service", WalletsService(wallets_dao=wallets_dao)
    )
    _mock_stripe(monkeypatch)

    for day, plan in (
        (6, "cloud_v0_business"),
        (11, "cloud_v0_pro"),
        (16, "cloud_v0_business"),
    ):
        _freeze_clock(monkeypatch, datetime(2026, 4, day, tzinfo=timezone.utc))
        await service.process_event(
            organization_id=organization_id,
            event=Event.SUBSCRIPTION_SWITCHED,
            plan=plan,
        )

    assert len(wallets_dao.plan_changes) == 3
    third = list(wallets_dao.plan_changes.values())[-1]
    assert third.replayed is False
    # 15 of 30 days of $50 left.
    assert third.incoming_credit_amount_musd == 25_000_000


@pytest.mark.asyncio
async def test_a_double_submitted_switch_changes_the_plan_once(monkeypatch):
    """Two concurrent submissions of the same switch. Without the lock both read Pro,
    both pass the "already on this plan" guard and both reach the wallet hook. With it,
    the second reads Business and is refused."""
    organization_id = str(uuid4())
    service, dao = _service(_pro_subscription(organization_id))
    fake_wallets = _RecordingWalletsService()
    monkeypatch.setattr(service, "wallets_service", fake_wallets)
    _mock_stripe(monkeypatch)

    results = await asyncio.gather(
        *(
            service.process_event(
                organization_id=organization_id,
                event=Event.SUBSCRIPTION_SWITCHED,
                plan="cloud_v0_business",
            )
            for _ in range(2)
        ),
        return_exceptions=True,
    )

    assert sum(isinstance(result, EventException) for result in results) == 1
    assert len(fake_wallets.calls) == 1
    assert dao._subscription.plan == "cloud_v0_business"


@pytest.mark.asyncio
async def test_the_same_delivery_id_applied_twice_moves_money_once(monkeypatch):
    """A Stripe retry carries the same `stripe_event.id`, so the second application is a
    replay and must move nothing. (`process_event` also skips the hook outright on a
    redelivery, since the plan no longer differs — this pins the layer that would still
    have to be safe if it did not.)"""
    organization_id = str(uuid4())
    service, _ = _service(
        SubscriptionDTO(
            organization_id=organization_id, plan="cloud_v0_hobby", active=True
        )
    )
    wallets_dao = FakeWalletsDAO(
        general_balance=build_general_wallet_balance(balance_musd=0, floor_musd=0)
    )
    monkeypatch.setattr(
        service, "wallets_service", WalletsService(wallets_dao=wallets_dao)
    )

    delivery = dict(
        organization_id=str(wallets_dao.general_balance.organization_id),
        subscription_id="sub_123",
        outgoing_plan="cloud_v0_hobby",
        incoming_plan="cloud_v0_pro",
        period_start=APRIL_START,
        period_end=APRIL_END,
        event_id="evt_retried",
        now=APRIL_START,
    )

    await service._apply_wallet_plan_change(**delivery)
    await service._apply_wallet_plan_change(**delivery)

    assert [key for _, key in wallets_dao.plan_changes] == ["plan_change:evt_retried"]
    assert wallets_dao.general_balance.balance_musd == 5_000_000
