"""The billing router's credit sources: monthly credits from a paid invoice, purchased
credits from a completed top-up Checkout, and the route that starts a top-up."""

from datetime import datetime, timezone
from json import loads
from types import SimpleNamespace
from unittest.mock import AsyncMock, Mock
from uuid import UUID, uuid4

import pytest
from fastapi import HTTPException

from ee.src.apis.fastapi.billing import router as billing_router_module
from ee.src.apis.fastapi.billing.router import TOP_UP_PURPOSE, BillingRouter
from ee.src.core.access.entitlements.types import DefaultPlan
from ee.src.core.subscriptions import service as subscriptions_service_module
from ee.src.core.subscriptions.service import SubscriptionsService
from ee.src.core.subscriptions.types import Event

PRO = DefaultPlan.CLOUD_V0_PRO.value
BUSINESS = DefaultPlan.CLOUD_V0_BUSINESS.value
HOBBY = DefaultPlan.CLOUD_V0_HOBBY.value

ORGANIZATION_ID = str(uuid4())

OCT_1 = 1790812800  # 2026-10-01T00:00:00Z
NOV_1 = 1793491200  # 2026-11-01T00:00:00Z
SEP_1 = 1788220800  # 2026-09-01T00:00:00Z


class DummyRequest:
    def __init__(self):
        self.headers = {}

    async def body(self):
        return b"{}"


def _ts(value):
    return datetime.fromtimestamp(value, tz=timezone.utc)


def _install_event(monkeypatch, event_type, data_object, *, signed=True):
    event = SimpleNamespace(type=event_type, data=SimpleNamespace(object=data_object))
    monkeypatch.setattr(billing_router_module.env.stripe, "api_key", "sk_test_123")
    monkeypatch.setattr(
        billing_router_module.env.stripe,
        "webhook_secret",
        "whsec_test" if signed else None,
    )
    monkeypatch.setattr(
        billing_router_module,
        "_load_stripe",
        lambda: SimpleNamespace(
            api_key="sk_test_123",
            Event=SimpleNamespace(construct_from=lambda payload, api_key: event),
            Webhook=SimpleNamespace(construct_event=lambda payload, sig, secret: event),
            error=SimpleNamespace(SignatureVerificationError=ValueError),
        ),
    )


def _router(subscription_service=None, wallets_service=None):
    return BillingRouter(
        subscription_service=subscription_service
        or SimpleNamespace(
            process_event=AsyncMock(return_value=object()),
            grant_period_credits=AsyncMock(),
        ),
        meters_service=SimpleNamespace(),
        wallets_service=wallets_service,
    )


def _line(start, end, *, type="subscription", proration=False):
    return {
        "type": type,
        "proration": proration,
        "period": {"start": start, "end": end},
    }


def _new_shape_line(start, end, *, proration=False):
    """A line as webhooks from API version 2025-03-31 on carry it."""
    return {
        "parent": {
            "type": "subscription_item_details",
            "subscription_item_details": {"proration": proration},
        },
        "period": {"start": start, "end": end},
    }


def _invoice(*, billing_reason, total=2900, lines=None, plan=PRO):
    return {
        "billing_reason": billing_reason,
        "total": total,
        "lines": {"data": lines if lines is not None else [_line(OCT_1, NOV_1)]},
        "subscription_details": {
            "metadata": {
                "target": billing_router_module.env.stripe.webhook_target,
                "organization_id": ORGANIZATION_ID,
                "plan": plan,
            }
        },
    }


# ---------------------------------------------------------------------------
# Monthly credits from invoice.payment_succeeded
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_renewal_invoice_grants_the_period_it_opens(monkeypatch):
    router = _router()
    # A renewal also bills the ended period's usage in arrears; the grant takes the
    # period the flat line opens.
    _install_event(
        monkeypatch,
        "invoice.payment_succeeded",
        _invoice(
            billing_reason="subscription_cycle",
            lines=[_line(SEP_1, OCT_1), _line(OCT_1, NOV_1)],
        ),
    )

    response = await router.handle_events(DummyRequest())

    assert response.status_code == 200
    router.subscription_service.grant_period_credits.assert_awaited_once_with(
        organization_id=ORGANIZATION_ID,
        plan=PRO,
        period_start=_ts(OCT_1),
        period_end=_ts(NOV_1),
    )
    router.subscription_service.process_event.assert_awaited_once()
    assert (
        router.subscription_service.process_event.await_args.kwargs["event"]
        == Event.SUBSCRIPTION_RESUMED
    )


@pytest.mark.asyncio
async def test_a_renewal_grants_the_plan_the_invoice_names(monkeypatch):
    # Paid as Business; delivered after a later switch to Pro. The invoice snapshots the
    # subscription metadata, which a switch rewrites, so it still names Business.
    router = _router()
    _install_event(
        monkeypatch,
        "invoice.payment_succeeded",
        _invoice(billing_reason="subscription_cycle", plan=BUSINESS),
    )

    await router.handle_events(DummyRequest())

    kwargs = router.subscription_service.grant_period_credits.await_args.kwargs
    assert kwargs["plan"] == BUSINESS


@pytest.mark.asyncio
async def test_the_period_comes_from_a_recurring_plan_line_only(monkeypatch):
    router = _router()
    late = OCT_1 + 86_400
    _install_event(
        monkeypatch,
        "invoice.payment_succeeded",
        _invoice(
            billing_reason="subscription_cycle",
            lines=[
                _line(OCT_1, NOV_1),
                # A proration and a one-off item added later must not win.
                _line(late, NOV_1, proration=True),
                _line(late, late, type="invoiceitem"),
            ],
        ),
    )

    await router.handle_events(DummyRequest())

    kwargs = router.subscription_service.grant_period_credits.await_args.kwargs
    assert (kwargs["period_start"], kwargs["period_end"]) == (_ts(OCT_1), _ts(NOV_1))


@pytest.mark.asyncio
async def test_the_period_reads_the_new_webhook_line_shape(monkeypatch):
    router = _router()
    _install_event(
        monkeypatch,
        "invoice.payment_succeeded",
        _invoice(
            billing_reason="subscription_cycle",
            lines=[
                _new_shape_line(SEP_1, OCT_1),
                _new_shape_line(OCT_1, NOV_1),
                _new_shape_line(OCT_1 + 60, NOV_1, proration=True),
            ],
        ),
    )

    await router.handle_events(DummyRequest())

    kwargs = router.subscription_service.grant_period_credits.await_args.kwargs
    assert kwargs["period_start"] == _ts(OCT_1)


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "invoice,signed",
    [
        (_invoice(billing_reason="subscription_cycle", lines=[]), True),
        (
            _invoice(
                billing_reason="subscription_cycle",
                lines=[_line(OCT_1, OCT_1)],
            ),
            True,
        ),
        (_invoice(billing_reason="subscription_cycle", plan="no_such_plan"), True),
        (_invoice(billing_reason="subscription_cycle", plan=None), True),
        (_invoice(billing_reason="subscription_cycle"), False),
    ],
    ids=["no-lines", "empty-period", "unknown-plan", "no-plan", "unsigned"],
)
async def test_a_paid_period_that_cannot_be_resolved_fails_the_webhook(
    monkeypatch, invoice, signed
):
    router = _router()
    _install_event(monkeypatch, "invoice.payment_succeeded", invoice, signed=signed)

    with pytest.raises(HTTPException) as error:
        await router.handle_events(DummyRequest())

    assert error.value.status_code == 500
    router.subscription_service.grant_period_credits.assert_not_awaited()


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "billing_reason,total",
    [
        ("subscription_create", 0),  # a trial start
        ("subscription_update", 1500),  # a plan switch's proration
        ("manual", 1500),
        (None, 1500),
    ],
)
async def test_invoices_that_open_no_paid_period_grant_nothing(
    monkeypatch, billing_reason, total
):
    router = _router()
    _install_event(
        monkeypatch,
        "invoice.payment_succeeded",
        _invoice(billing_reason=billing_reason, total=total),
    )

    response = await router.handle_events(DummyRequest())

    assert response.status_code == 200
    router.subscription_service.grant_period_credits.assert_not_awaited()
    router.subscription_service.process_event.assert_awaited_once()


@pytest.mark.asyncio
async def test_a_failed_grant_fails_the_webhook_so_stripe_redelivers(monkeypatch):
    router = _router()
    router.subscription_service.grant_period_credits.side_effect = RuntimeError("db")
    _install_event(
        monkeypatch,
        "invoice.payment_succeeded",
        _invoice(billing_reason="subscription_cycle"),
    )

    with pytest.raises(HTTPException) as error:
        await router.handle_events(DummyRequest())

    assert error.value.status_code == 500


# ---------------------------------------------------------------------------
# SubscriptionsService.grant_period_credits
# ---------------------------------------------------------------------------


def _subscriptions_service():
    wallets_service = SimpleNamespace(
        grant_period_allowance=AsyncMock(return_value=None)
    )
    return (
        SubscriptionsService(
            subscriptions_dao=SimpleNamespace(), wallets_service=wallets_service
        ),
        wallets_service,
    )


@pytest.mark.asyncio
async def test_period_credits_go_to_the_wallet(monkeypatch):
    monkeypatch.setattr(subscriptions_service_module.env.wallets, "enabled", True)
    service, wallets = _subscriptions_service()

    await service.grant_period_credits(
        organization_id=ORGANIZATION_ID,
        plan=PRO,
        period_start=_ts(OCT_1),
        period_end=_ts(NOV_1),
    )

    wallets.grant_period_allowance.assert_awaited_once_with(
        organization_id=UUID(ORGANIZATION_ID),
        plan=PRO,
        period_start=_ts(OCT_1),
        period_end=_ts(NOV_1),
    )


@pytest.mark.asyncio
async def test_no_period_credits_while_the_wallet_is_off(monkeypatch):
    monkeypatch.setattr(subscriptions_service_module.env.wallets, "enabled", False)
    service, wallets = _subscriptions_service()

    await service.grant_period_credits(
        organization_id=ORGANIZATION_ID,
        plan=PRO,
        period_start=_ts(OCT_1),
        period_end=_ts(NOV_1),
    )

    wallets.grant_period_allowance.assert_not_awaited()


# ---------------------------------------------------------------------------
# Top-ups: checkout.session.completed
# ---------------------------------------------------------------------------


def _session(**overrides):
    session = {
        "id": "cs_test_123",
        "mode": "payment",
        "payment_status": "paid",
        "currency": "usd",
        "amount_subtotal": 2_500,
        "metadata": {
            "target": billing_router_module.env.stripe.webhook_target,
            "organization_id": ORGANIZATION_ID,
            "purpose": TOP_UP_PURPOSE,
            "pack": "credits_2500",
        },
    }
    session.update(overrides)
    return session


@pytest.mark.asyncio
async def test_paid_top_up_grants_its_pack(monkeypatch):
    wallets = SimpleNamespace(
        grant_purchase=AsyncMock(return_value=SimpleNamespace(amount_musd=25_000_000))
    )
    router = _router(wallets_service=wallets)
    _install_event(monkeypatch, "checkout.session.completed", _session())

    response = await router.handle_events(DummyRequest())

    assert response.status_code == 200
    assert loads(response.body) == {"status": "success"}
    wallets.grant_purchase.assert_awaited_once_with(
        organization_id=UUID(ORGANIZATION_ID),
        checkout_session_id="cs_test_123",
        amount_musd=25_000_000,
    )
    router.subscription_service.process_event.assert_not_awaited()


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "overrides",
    [
        {"mode": "subscription"},
        {"payment_status": "unpaid"},
        {
            "metadata": {
                "target": billing_router_module.env.stripe.webhook_target,
                "organization_id": ORGANIZATION_ID,
            }
        },
    ],
)
async def test_sessions_that_are_not_a_paid_top_up_grant_nothing(
    monkeypatch, overrides
):
    wallets = SimpleNamespace(grant_purchase=AsyncMock())
    router = _router(wallets_service=wallets)
    _install_event(monkeypatch, "checkout.session.completed", _session(**overrides))

    response = await router.handle_events(DummyRequest())

    assert response.status_code == 200
    assert loads(response.body)["status"] == "skip"
    wallets.grant_purchase.assert_not_awaited()


@pytest.mark.asyncio
async def test_an_unsigned_top_up_event_grants_nothing(monkeypatch):
    wallets = SimpleNamespace(grant_purchase=AsyncMock())
    router = _router(wallets_service=wallets)
    _install_event(monkeypatch, "checkout.session.completed", _session(), signed=False)

    response = await router.handle_events(DummyRequest())

    assert response.status_code == 400
    wallets.grant_purchase.assert_not_awaited()


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "overrides",
    [
        {"amount_subtotal": 1_000},
        {"currency": "eur"},
        {
            "metadata": {
                "target": billing_router_module.env.stripe.webhook_target,
                "organization_id": ORGANIZATION_ID,
                "purpose": TOP_UP_PURPOSE,
                "pack": "credits_999999",
            }
        },
    ],
)
async def test_a_top_up_that_matches_no_pack_is_refused(monkeypatch, overrides):
    wallets = SimpleNamespace(grant_purchase=AsyncMock())
    router = _router(wallets_service=wallets)
    _install_event(monkeypatch, "checkout.session.completed", _session(**overrides))

    response = await router.handle_events(DummyRequest())

    assert response.status_code == 400
    wallets.grant_purchase.assert_not_awaited()


# ---------------------------------------------------------------------------
# Top-ups: starting the Checkout
# ---------------------------------------------------------------------------


def _stripe_for_checkout():
    create = Mock(return_value=SimpleNamespace(url="https://checkout.example/cs"))
    return SimpleNamespace(
        checkout=SimpleNamespace(Session=SimpleNamespace(create=create))
    )


def _subscription(plan, subscription_id="sub_123", customer_id="cus_123"):
    return SimpleNamespace(
        plan=plan, subscription_id=subscription_id, customer_id=customer_id
    )


@pytest.fixture
def top_up_ready(monkeypatch):
    monkeypatch.setattr(billing_router_module.env.wallets, "enabled", True)
    monkeypatch.setattr(billing_router_module.env.stripe, "webhook_secret", "whsec_x")
    monkeypatch.setattr(billing_router_module, "get_free_plan", lambda: HOBBY)
    stripe = _stripe_for_checkout()
    monkeypatch.setattr(billing_router_module, "_load_stripe", lambda: stripe)
    return stripe


@pytest.mark.asyncio
async def test_top_up_checkout_is_a_one_time_payment_for_the_pack(top_up_ready):
    router = _router(
        subscription_service=SimpleNamespace(
            read=AsyncMock(return_value=_subscription(PRO))
        )
    )

    result = await router.create_top_up_checkout(
        organization_id=ORGANIZATION_ID,
        pack="credits_10000",
        success_url="https://app.example/billing",
    )

    assert result == {"checkout_url": "https://checkout.example/cs"}
    kwargs = top_up_ready.checkout.Session.create.call_args.kwargs
    assert kwargs["mode"] == "payment"
    assert kwargs["customer"] == "cus_123"
    assert kwargs["line_items"][0]["price_data"]["unit_amount"] == 10_000
    assert kwargs["line_items"][0]["price_data"]["currency"] == "usd"
    assert kwargs["metadata"] == {
        "organization_id": ORGANIZATION_ID,
        "target": billing_router_module.env.stripe.webhook_target,
        "purpose": TOP_UP_PURPOSE,
        "pack": "credits_10000",
    }


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "subscription",
    [
        None,
        _subscription(HOBBY),
        _subscription(PRO, subscription_id=None),
        _subscription(PRO, customer_id=None),
    ],
)
async def test_top_up_checkout_needs_a_paid_plan(top_up_ready, subscription):
    router = _router(
        subscription_service=SimpleNamespace(read=AsyncMock(return_value=subscription))
    )

    with pytest.raises(HTTPException) as error:
        await router.create_top_up_checkout(
            organization_id=ORGANIZATION_ID,
            pack="credits_1000",
            success_url="https://app.example/billing",
        )

    assert error.value.status_code == 400
    top_up_ready.checkout.Session.create.assert_not_called()


@pytest.mark.asyncio
async def test_top_up_checkout_refuses_an_unknown_pack(top_up_ready):
    router = _router(
        subscription_service=SimpleNamespace(
            read=AsyncMock(return_value=_subscription(PRO))
        )
    )

    with pytest.raises(HTTPException) as error:
        await router.create_top_up_checkout(
            organization_id=ORGANIZATION_ID,
            pack="credits_5",
            success_url="https://app.example/billing",
        )

    assert error.value.status_code == 400


@pytest.mark.asyncio
async def test_top_up_checkout_is_absent_while_the_wallet_is_off(
    top_up_ready, monkeypatch
):
    monkeypatch.setattr(billing_router_module.env.wallets, "enabled", False)
    router = _router(subscription_service=SimpleNamespace(read=AsyncMock()))

    with pytest.raises(HTTPException) as error:
        await router.create_top_up_checkout(
            organization_id=ORGANIZATION_ID,
            pack="credits_1000",
            success_url="https://app.example/billing",
        )

    assert error.value.status_code == 404


@pytest.mark.asyncio
async def test_top_up_checkout_is_absent_without_a_webhook_secret(
    top_up_ready, monkeypatch
):
    monkeypatch.setattr(billing_router_module.env.stripe, "webhook_secret", None)
    router = _router(subscription_service=SimpleNamespace(read=AsyncMock()))

    with pytest.raises(HTTPException) as error:
        await router.create_top_up_checkout(
            organization_id=ORGANIZATION_ID,
            pack="credits_1000",
            success_url="https://app.example/billing",
        )

    assert error.value.status_code == 404
    top_up_ready.checkout.Session.create.assert_not_called()
