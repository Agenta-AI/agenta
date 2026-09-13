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
from ee.src.core.wallets.service import WalletsService
from ee.tests.pytest.utils.wallets.builders import build_general_wallet_balance
from ee.tests.pytest.utils.wallets.fakes import FakeWalletsDAO
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
    assert (
        call["idempotency_key"]
        == "plan_change:none:2026-03-25T00:00:00+00:00:cloud_v0_pro:cloud_v0_hobby"
    )


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
    assert (
        call["idempotency_key"]
        == "plan_change:sub_123:2026-03-14T00:00:00+00:00:cloud_v0_hobby:cloud_v0_pro"
    )


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
    assert (
        call["idempotency_key"]
        == "plan_change:sub_123:2026-03-08T00:00:00+00:00:cloud_v0_pro:cloud_v0_business"
    )


def _mock_stripe(monkeypatch):
    """The direct plan-switch route talks to Stripe before it updates the row."""
    stripe = MagicMock()
    stripe.SubscriptionItem.list.return_value.data = []
    monkeypatch.setattr(subscriptions_service_module, "_load_stripe", lambda: stripe)
    monkeypatch.setattr(
        subscriptions_service_module, "get_stripe_line_items", lambda plan: []
    )


@pytest.mark.asyncio
async def test_webhook_delivery_id_becomes_the_idempotency_key(monkeypatch):
    """Stripe reuses `stripe_event.id` when it retries a delivery and issues a new one
    for every distinct change, so when the webhook supplies it, it IS the occurrence's
    identity and nothing else belongs in the key."""
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
    _freeze_clock(monkeypatch, datetime(2026, 4, 1, tzinfo=timezone.utc))

    await service.process_event(
        organization_id=organization_id,
        event=Event.SUBSCRIPTION_CREATED,
        subscription_id="sub_123",
        plan="cloud_v0_pro",
        anchor=1,
        event_id="evt_1KjH9xCreated",
    )

    assert fake_wallets.calls[0]["idempotency_key"] == "plan_change:evt_1KjH9xCreated"


@pytest.mark.asyncio
async def test_direct_route_without_a_delivery_id_keys_on_period_and_transition(
    monkeypatch,
):
    """The direct plan-switch and cancel routes are synchronous user actions with no
    delivery to identify, so they key on what they do know: the subscription, the billing
    period, and the transition. The transition is what separates two different changes in
    one period; keeping the key a function of the change (rather than of the call) is what
    still absorbs a concurrent double-submit of the same change."""
    organization_id = str(uuid4())
    subscription = SubscriptionDTO(
        organization_id=organization_id,
        subscription_id="sub_123",
        plan="cloud_v0_pro",
        active=True,
        anchor=1,
    )
    service = SubscriptionsService(
        subscriptions_dao=_FakeSubscriptionsDAO(subscription)
    )

    fake_wallets = _RecordingWalletsService()
    monkeypatch.setattr(
        subscriptions_service_module, "get_wallets_service", lambda: fake_wallets
    )
    _mock_stripe(monkeypatch)
    _freeze_clock(monkeypatch, datetime(2026, 4, 16, tzinfo=timezone.utc))

    await service.process_event(
        organization_id=organization_id,
        event=Event.SUBSCRIPTION_SWITCHED,
        plan="cloud_v0_business",
    )

    assert (
        fake_wallets.calls[0]["idempotency_key"]
        == "plan_change:sub_123:2026-04-01T00:00:00+00:00:cloud_v0_pro:cloud_v0_business"
    )


@pytest.mark.asyncio
async def test_create_then_switch_in_one_billing_period_both_move_money(monkeypatch):
    """The ordinary flow that the period-scoped key used to swallow. Create Pro on
    1 April anchored on the 1st, upgrade to Business on the 16th: the switch never moves
    the anchor, so both changes land in the SAME window (1 April -> 1 May) for the SAME
    subscription and used to produce one byte-identical key — the upgrade was treated as
    a replay of the creation and moved nothing, leaving the customer on $5 of allowance
    instead of $27.50.

    They key differently now for two reasons at once: the creation arrives over the
    webhook and is identified by its Stripe delivery, and the switch is a direct route
    that falls back to the period key. Real `plans.py` amounts, real `WalletsService`
    over the in-memory DAO.
    """
    organization_id = str(uuid4())
    subscription = SubscriptionDTO(
        organization_id=organization_id, plan="cloud_v0_hobby", active=True, anchor=1
    )
    service = SubscriptionsService(
        subscriptions_dao=_FakeSubscriptionsDAO(subscription)
    )

    dao = FakeWalletsDAO(
        general_balance=build_general_wallet_balance(balance_musd=0, floor_musd=0)
    )
    wallets = WalletsService(wallets_dao=dao)
    monkeypatch.setattr(
        subscriptions_service_module, "get_wallets_service", lambda: wallets
    )

    _freeze_clock(monkeypatch, datetime(2026, 4, 1, tzinfo=timezone.utc))
    await service.process_event(
        organization_id=organization_id,
        event=Event.SUBSCRIPTION_CREATED,
        subscription_id="sub_123",
        plan="cloud_v0_pro",
        anchor=1,
        event_id="evt_created",
    )

    # The whole period ahead: the full $5 Pro allowance.
    assert dao.general_balance.balance_musd == 5_000_000

    _mock_stripe(monkeypatch)
    _freeze_clock(monkeypatch, datetime(2026, 4, 16, tzinfo=timezone.utc))
    await service.process_event(
        organization_id=organization_id,
        event=Event.SUBSCRIPTION_SWITCHED,
        plan="cloud_v0_business",
    )

    # Exactly half the 30-day period remains (1_296_000 of 2_592_000 seconds): $2.50 of
    # the Pro allowance is clawed back and $25 of the Business allowance is minted.
    assert len(dao.plan_changes) == 2  # two distinct keys, two applications
    assert sorted(key for _, key in dao.plan_changes) == [
        "plan_change:evt_created",
        "plan_change:sub_123:2026-04-01T00:00:00+00:00:cloud_v0_pro:cloud_v0_business",
    ]
    switch_result = dao.plan_changes[
        (
            dao.general_balance.organization_id,
            "plan_change:sub_123:2026-04-01T00:00:00+00:00:cloud_v0_pro:cloud_v0_business",
        )
    ]
    assert switch_result.outgoing_debit_amount_musd == 2_500_000
    assert switch_result.incoming_credit_amount_musd == 25_000_000
    assert dao.general_balance.balance_musd == 27_500_000  # $27.50, not $5


@pytest.mark.asyncio
async def test_the_same_delivery_id_applied_twice_moves_money_once(monkeypatch):
    """A Stripe retry carries the same `stripe_event.id`, so the second application is a
    replay and must move nothing. (`process_event` also skips the hook outright on a
    redelivery, since the plan no longer differs — this pins the layer that would still
    have to be safe if it did not.)"""
    organization_id = str(uuid4())
    service = SubscriptionsService(
        subscriptions_dao=_FakeSubscriptionsDAO(
            SubscriptionDTO(
                organization_id=organization_id, plan="cloud_v0_hobby", active=True
            )
        )
    )

    dao = FakeWalletsDAO(
        general_balance=build_general_wallet_balance(balance_musd=0, floor_musd=0)
    )
    wallets = WalletsService(wallets_dao=dao)
    monkeypatch.setattr(
        subscriptions_service_module, "get_wallets_service", lambda: wallets
    )

    delivery = dict(
        organization_id=str(dao.general_balance.organization_id),
        event=Event.SUBSCRIPTION_CREATED,
        subscription_id="sub_123",
        outgoing_plan="cloud_v0_hobby",
        incoming_plan="cloud_v0_pro",
        outgoing_anchor=1,
        incoming_anchor=1,
        event_id="evt_retried",
        now=datetime(2026, 4, 1, tzinfo=timezone.utc),
    )

    await service._apply_wallet_plan_change(**delivery)
    assert dao.general_balance.balance_musd == 5_000_000

    await service._apply_wallet_plan_change(**delivery)

    assert len(dao.plan_changes) == 1
    # Deduplicated on the delivery id itself, not on the period it happens to fall in.
    assert [key for _, key in dao.plan_changes] == ["plan_change:evt_retried"]
    assert dao.general_balance.balance_musd == 5_000_000  # replayed, not re-applied


@pytest.mark.asyncio
async def test_two_direct_switches_in_one_billing_period_both_move_money(monkeypatch):
    """Open-designs item 22's collision, on the only routes that can still reach it.
    Upgrade Pro to Business on 16 September and downgrade Business to Pro on the 21st:
    same subscription, same 1 September window, no Stripe delivery to identify either.
    Under a key that named only the subscription and the period they were one key and the
    second moved nothing, leaving the wallet funded for Business while the subscription
    said Pro. The transition in the key separates them.

    30-day period (2_592_000 seconds). The upgrade lands with exactly half left, the
    downgrade with exactly a third.
    """
    organization_id = str(uuid4())
    subscription = SubscriptionDTO(
        organization_id=organization_id,
        subscription_id="sub_123",
        plan="cloud_v0_pro",
        active=True,
        anchor=1,
    )
    service = SubscriptionsService(
        subscriptions_dao=_FakeSubscriptionsDAO(subscription)
    )

    dao = FakeWalletsDAO(
        general_balance=build_general_wallet_balance(balance_musd=0, floor_musd=0)
    )
    wallets = WalletsService(wallets_dao=dao)
    monkeypatch.setattr(
        subscriptions_service_module, "get_wallets_service", lambda: wallets
    )
    _mock_stripe(monkeypatch)

    _freeze_clock(monkeypatch, datetime(2026, 9, 16, tzinfo=timezone.utc))
    await service.process_event(
        organization_id=organization_id,
        event=Event.SUBSCRIPTION_SWITCHED,
        plan="cloud_v0_business",
    )

    # Half the period left, no prior allowance credit to claw back: $25 of $50 minted.
    assert dao.general_balance.balance_musd == 25_000_000

    _freeze_clock(monkeypatch, datetime(2026, 9, 21, tzinfo=timezone.utc))
    await service.process_event(
        organization_id=organization_id,
        event=Event.SUBSCRIPTION_SWITCHED,
        plan="cloud_v0_pro",
    )

    assert len(dao.plan_changes) == 2  # two transitions, two keys, two applications
    assert sorted(key for _, key in dao.plan_changes) == [
        "plan_change:sub_123:2026-09-01T00:00:00+00:00:cloud_v0_business:cloud_v0_pro",
        "plan_change:sub_123:2026-09-01T00:00:00+00:00:cloud_v0_pro:cloud_v0_business",
    ]
    downgrade = dao.plan_changes[
        (
            dao.general_balance.organization_id,
            "plan_change:sub_123:2026-09-01T00:00:00+00:00:cloud_v0_business:cloud_v0_pro",
        )
    ]
    # A third of the period left: 50_000_000 * 864_000 // 2_592_000 clawed back,
    # 5_000_000 * 864_000 // 2_592_000 minted.
    assert downgrade.outgoing_debit_amount_musd == 16_666_666
    assert downgrade.incoming_credit_amount_musd == 1_666_666
    assert dao.general_balance.balance_musd == 10_000_000  # not stuck at 25_000_000


@pytest.mark.asyncio
async def test_the_registers_worked_example_ends_on_the_right_balance(monkeypatch):
    """Item 22's worked failure end to end: upgrade Pro to Business on the 4th, cancel to
    Free on the 19th, both in the 1 September period. In this codebase the pair was never
    one key — the cancel branch nulls `subscription_id` before the hook runs and re-anchors the
    subscription to today, so it keys on `none` and on the 19th — but the sequence is the
    one the register asks to end correctly, and the transition now shows in both keys.
    The clawback is still taken over the OUTGOING window (1 September to 1 October), which
    is the period the Business allowance was granted for."""
    organization_id = str(uuid4())
    subscription = SubscriptionDTO(
        organization_id=organization_id,
        subscription_id="sub_123",
        plan="cloud_v0_pro",
        active=True,
        anchor=1,
    )
    service = SubscriptionsService(
        subscriptions_dao=_FakeSubscriptionsDAO(subscription)
    )

    dao = FakeWalletsDAO(
        general_balance=build_general_wallet_balance(balance_musd=0, floor_musd=0)
    )
    wallets = WalletsService(wallets_dao=dao)
    monkeypatch.setattr(
        subscriptions_service_module, "get_wallets_service", lambda: wallets
    )
    _mock_stripe(monkeypatch)

    _freeze_clock(monkeypatch, datetime(2026, 9, 4, tzinfo=timezone.utc))
    await service.process_event(
        organization_id=organization_id,
        event=Event.SUBSCRIPTION_SWITCHED,
        plan="cloud_v0_business",
    )

    # 27 of the 30 days still ahead: 50_000_000 * 2_332_800 // 2_592_000.
    assert dao.general_balance.balance_musd == 45_000_000

    _freeze_clock(monkeypatch, datetime(2026, 9, 19, tzinfo=timezone.utc))
    result = await service.process_event(
        organization_id=organization_id,
        event=Event.SUBSCRIPTION_CANCELLED,
    )

    assert result.plan == "cloud_v0_hobby"
    assert sorted(key for _, key in dao.plan_changes) == [
        "plan_change:none:2026-09-19T00:00:00+00:00:cloud_v0_business:cloud_v0_hobby",
        "plan_change:sub_123:2026-09-01T00:00:00+00:00:cloud_v0_pro:cloud_v0_business",
    ]
    # 12 of the 30 days still ahead: 50_000_000 * 1_036_800 // 2_592_000 clawed back, and
    # Free mints nothing. The customer keeps what they used, not the whole allowance.
    assert dao.general_balance.balance_musd == 45_000_000 - 20_000_000
    assert dao.general_balance.balance_musd == 25_000_000
