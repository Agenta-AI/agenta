from json import loads
from types import SimpleNamespace
from unittest.mock import AsyncMock, Mock

import pytest

from ee.src.apis.fastapi.billing import router as billing_router_module
from ee.src.apis.fastapi.billing.router import BillingRouter
from ee.src.core.entitlements.types import DefaultPlan
from ee.src.core.subscriptions.types import Event


@pytest.mark.asyncio
async def test_fetch_subscription_reads_periods_from_stripe_objects(monkeypatch):
    subscription_service = SimpleNamespace(
        read=AsyncMock(
            return_value=SimpleNamespace(
                plan=DefaultPlan.CLOUD_V0_PRO.value,
                anchor=12,
                subscription_id="sub_123",
            )
        )
    )
    router = BillingRouter(
        subscription_service=subscription_service,
        meters_service=SimpleNamespace(),
    )

    monkeypatch.setattr(billing_router_module.env.stripe, "api_key", "sk_test_123")
    monkeypatch.setattr(
        billing_router_module.stripe.Subscription,
        "retrieve",
        lambda id: SimpleNamespace(
            items=SimpleNamespace(
                data=[
                    SimpleNamespace(
                        current_period_start=1710000000,
                        current_period_end=1712592000,
                    )
                ]
            ),
            status="trialing",
        ),
    )

    result = await router.fetch_subscription(
        organization_id="org_123",
    )

    assert result == {
        "plan": DefaultPlan.CLOUD_V0_PRO.value,
        "type": "standard",
        "period_start": 1710000000,
        "period_end": 1712592000,
        "free_trial": True,
    }


class DummyRequest:
    def __init__(self, payload: bytes = b"{}"):
        self._payload = payload
        self.headers = {}

    async def body(self):
        return self._payload


@pytest.mark.asyncio
async def test_handle_events_reads_subscription_created_metadata_from_stripe_objects(
    monkeypatch,
):
    subscription_service = SimpleNamespace(
        process_event=AsyncMock(return_value=object()),
    )
    router = BillingRouter(
        subscription_service=subscription_service,
        meters_service=SimpleNamespace(),
    )
    request = DummyRequest()

    monkeypatch.setattr(billing_router_module.env.stripe, "api_key", "sk_test_123")
    monkeypatch.setattr(billing_router_module.env.stripe, "webhook_secret", None)
    monkeypatch.setattr(
        billing_router_module.stripe.Event,
        "construct_from",
        lambda payload, api_key: SimpleNamespace(
            type="customer.subscription.created",
            data=SimpleNamespace(
                object=SimpleNamespace(
                    id="sub_123",
                    billing_cycle_anchor=1710000000,
                    metadata=SimpleNamespace(
                        target=billing_router_module.env.stripe.webhook_target,
                        organization_id="org_123",
                        plan=DefaultPlan.CLOUD_V0_PRO.value,
                    ),
                )
            ),
        ),
    )

    response = await router.handle_events(request)

    assert response.status_code == 200
    assert loads(response.body) == {"status": "success"}
    subscription_service.process_event.assert_awaited_once_with(
        organization_id="org_123",
        event=Event.SUBSCRIPTION_CREATED,
        subscription_id="sub_123",
        plan=DefaultPlan.CLOUD_V0_PRO.value,
        anchor=9,
    )


@pytest.mark.asyncio
async def test_handle_events_reads_invoice_metadata_from_stripe_objects(monkeypatch):
    subscription_service = SimpleNamespace(
        process_event=AsyncMock(return_value=object()),
    )
    router = BillingRouter(
        subscription_service=subscription_service,
        meters_service=SimpleNamespace(),
    )
    request = DummyRequest()

    monkeypatch.setattr(billing_router_module.env.stripe, "api_key", "sk_test_123")
    monkeypatch.setattr(billing_router_module.env.stripe, "webhook_secret", None)
    monkeypatch.setattr(
        billing_router_module.stripe.Event,
        "construct_from",
        lambda payload, api_key: SimpleNamespace(
            type="invoice.payment_succeeded",
            data=SimpleNamespace(
                object=SimpleNamespace(
                    subscription_details=SimpleNamespace(
                        metadata=SimpleNamespace(
                            target=billing_router_module.env.stripe.webhook_target,
                            organization_id="org_456",
                        )
                    )
                )
            ),
        ),
    )

    response = await router.handle_events(request)

    assert response.status_code == 200
    assert loads(response.body) == {"status": "success"}
    subscription_service.process_event.assert_awaited_once_with(
        organization_id="org_456",
        event=Event.SUBSCRIPTION_RESUMED,
        subscription_id=None,
        plan=None,
        anchor=None,
    )


@pytest.mark.asyncio
async def test_cancel_subscription_updates_local_state_after_stripe_cancel(monkeypatch):
    subscription_service = SimpleNamespace(
        read=AsyncMock(
            return_value=SimpleNamespace(
                plan=DefaultPlan.CLOUD_V0_BUSINESS.value,
                subscription_id="sub_123",
            )
        ),
        process_event=AsyncMock(return_value=object()),
    )
    router = BillingRouter(
        subscription_service=subscription_service,
        meters_service=SimpleNamespace(),
    )
    router._reset_organization_flags = AsyncMock()

    retrieve = Mock(return_value=SimpleNamespace(status="active"))
    cancel = Mock()
    monkeypatch.setattr(billing_router_module.stripe.Subscription, "retrieve", retrieve)
    monkeypatch.setattr(billing_router_module.stripe.Subscription, "cancel", cancel)

    response = await router.cancel_subscription(organization_id="org_123")

    assert response.status_code == 200
    retrieve.assert_called_once_with("sub_123")
    cancel.assert_called_once_with("sub_123")
    subscription_service.process_event.assert_awaited_once_with(
        organization_id="org_123",
        event=Event.SUBSCRIPTION_CANCELLED,
    )
    router._reset_organization_flags.assert_awaited_once_with("org_123")


@pytest.mark.asyncio
async def test_cancel_subscription_is_idempotent_for_free_plan_without_stripe_subscription():
    subscription_service = SimpleNamespace(
        read=AsyncMock(
            return_value=SimpleNamespace(
                plan=DefaultPlan.CLOUD_V0_HOBBY.value,
                subscription_id=None,
            )
        ),
        process_event=AsyncMock(),
    )
    router = BillingRouter(
        subscription_service=subscription_service,
        meters_service=SimpleNamespace(),
    )

    response = await router.cancel_subscription(organization_id="org_123")

    assert response.status_code == 200
    subscription_service.process_event.assert_not_awaited()


@pytest.mark.asyncio
async def test_cancel_subscription_reconciles_when_stripe_is_already_canceled(
    monkeypatch,
):
    subscription_service = SimpleNamespace(
        read=AsyncMock(
            return_value=SimpleNamespace(
                plan=DefaultPlan.CLOUD_V0_BUSINESS.value,
                subscription_id="sub_123",
            )
        ),
        process_event=AsyncMock(return_value=object()),
    )
    router = BillingRouter(
        subscription_service=subscription_service,
        meters_service=SimpleNamespace(),
    )
    router._reset_organization_flags = AsyncMock()

    retrieve = Mock(return_value=SimpleNamespace(status="canceled"))
    cancel = Mock()
    monkeypatch.setattr(billing_router_module.stripe.Subscription, "retrieve", retrieve)
    monkeypatch.setattr(billing_router_module.stripe.Subscription, "cancel", cancel)

    response = await router.cancel_subscription(organization_id="org_123")

    assert response.status_code == 200
    retrieve.assert_called_once_with("sub_123")
    cancel.assert_not_called()
    subscription_service.process_event.assert_awaited_once_with(
        organization_id="org_123",
        event=Event.SUBSCRIPTION_CANCELLED,
    )
    router._reset_organization_flags.assert_awaited_once_with("org_123")
