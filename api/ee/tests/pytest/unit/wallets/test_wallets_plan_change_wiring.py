"""Unit tests for the B2 wiring: `SubscriptionsService.process_event` must call the
wallet plan-change hook exactly when the subscription's plan actually changes, and must
never let a wallet-side failure propagate out of the billing-webhook boundary. The
proration arithmetic itself is tested in `test_wallets_proration.py`, and the DAO-level
replay/idempotency/immutability behavior in `test_wallets_provisioning.py` — this file
only covers the subscriptions-service call site.
"""

from uuid import uuid4

import pytest

import ee.src.core.subscriptions.service as subscriptions_service_module
from ee.src.core.subscriptions.service import SubscriptionsService
from ee.src.core.subscriptions.types import Event, SubscriptionDTO


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
