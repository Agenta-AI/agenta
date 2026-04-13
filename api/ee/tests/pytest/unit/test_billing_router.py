from json import loads
from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest

from ee.src.apis.fastapi.billing import router as billing_router_module
from ee.src.apis.fastapi.billing.router import BillingRouter
from ee.src.core.subscriptions.types import Event, Plan


@pytest.mark.asyncio
async def test_fetch_subscription_reads_periods_from_stripe_objects(monkeypatch):
    subscription_service = SimpleNamespace(
        read=AsyncMock(
            return_value=SimpleNamespace(
                plan=Plan.CLOUD_V0_PRO,
                anchor=12,
                subscription_id="sub_123",
            )
        )
    )
    router = BillingRouter(
        subscription_service=subscription_service,
        meters_service=SimpleNamespace(),
        tracing_service=SimpleNamespace(),
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
        "plan": Plan.CLOUD_V0_PRO.value,
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
        tracing_service=SimpleNamespace(),
    )
    request = DummyRequest()

    monkeypatch.setattr(billing_router_module.env.stripe, "api_key", "sk_test_123")
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
                        plan=Plan.CLOUD_V0_PRO.value,
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
        plan=Plan.CLOUD_V0_PRO,
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
        tracing_service=SimpleNamespace(),
    )
    request = DummyRequest()

    monkeypatch.setattr(billing_router_module.env.stripe, "api_key", "sk_test_123")
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
