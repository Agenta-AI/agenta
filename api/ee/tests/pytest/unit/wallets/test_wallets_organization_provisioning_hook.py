"""Unit tests for the B1/B3 wiring: `ee.src.core.organizations.service.
_provision_wallet_general_balance` is the hook both `provision_signup_subscription` and
`provision_user_subscription` call after organization/subscription creation;
`_award_signup_grant` is the B3 hook `provision_signup_subscription` ALONE calls, after
the balance row exists. Idempotency of the underlying provisioning/award itself is
tested at the wallets layer in `test_wallets_provisioning.py`/`test_wallets_grants.py`;
this file covers only the organizations-service call sites: that they are called, with
the right args, unconditionally on every call (idempotent by construction one layer
down), and that a failure propagates rather than being silently swallowed (organization
creation should surface a provisioning/award bug, not hide it).
"""

from uuid import uuid4

import pytest

import ee.src.core.organizations.service as organizations_service_module
from oss.src.utils.env import env


@pytest.fixture(autouse=True)
def _wallets_enabled(monkeypatch):
    """The wallet ships behind AGENTA_WALLETS_ENABLED, default off; every call site
    guarded by it is a no-op otherwise. These tests cover the flag-on behaviour."""
    monkeypatch.setattr(env.wallets, "enabled", True)


class _RecordingWalletsService:
    def __init__(self):
        self.calls = []
        self.award_calls = []

    async def provision_general_balance(self, *, organization_id, plan):
        self.calls.append((organization_id, plan))

    async def award(self, *, organization_id, activity_code):
        self.award_calls.append((organization_id, activity_code))


class _FailingWalletsService:
    async def provision_general_balance(self, *, organization_id, plan):
        raise RuntimeError("simulated provisioning failure")

    async def award(self, *, organization_id, activity_code):
        raise RuntimeError("simulated award failure")


@pytest.mark.asyncio
async def test_provision_wallet_general_balance_hook_calls_service_idempotently(
    monkeypatch,
):
    fake = _RecordingWalletsService()
    monkeypatch.setattr(
        organizations_service_module, "get_wallets_service", lambda: fake
    )

    organization_id = uuid4()

    await organizations_service_module._provision_wallet_general_balance(
        organization_id=organization_id, plan="cloud_v0_hobby"
    )
    await organizations_service_module._provision_wallet_general_balance(
        organization_id=organization_id, plan="cloud_v0_hobby"
    )

    # Two calls in, two calls out — idempotency is the wallets-layer's job (the partial
    # unique index / FakeWalletsDAO no-op, see test_wallets_provisioning.py); this hook's
    # only contract is to call unconditionally, every time, without raising on a repeat.
    assert fake.calls == [
        (organization_id, "cloud_v0_hobby"),
        (organization_id, "cloud_v0_hobby"),
    ]


@pytest.mark.asyncio
async def test_provision_wallet_general_balance_hook_reraises_on_failure(monkeypatch):
    monkeypatch.setattr(
        organizations_service_module,
        "get_wallets_service",
        lambda: _FailingWalletsService(),
    )

    with pytest.raises(RuntimeError):
        await organizations_service_module._provision_wallet_general_balance(
            organization_id=uuid4(), plan="cloud_v0_hobby"
        )


@pytest.mark.asyncio
async def test_award_signup_grant_hook_calls_service_idempotently(monkeypatch):
    fake = _RecordingWalletsService()
    monkeypatch.setattr(
        organizations_service_module, "get_wallets_service", lambda: fake
    )

    organization_id = uuid4()

    await organizations_service_module._award_signup_grant(
        organization_id=organization_id
    )
    await organizations_service_module._award_signup_grant(
        organization_id=organization_id
    )

    # Two calls in, two calls out — idempotency is the wallets-layer's job
    # (`award_credit`'s replay guard, see test_wallets_grants.py); this hook's only
    # contract is to call unconditionally, every time, without raising on a repeat.
    assert fake.award_calls == [
        (organization_id, "signup"),
        (organization_id, "signup"),
    ]


@pytest.mark.asyncio
async def test_award_signup_grant_hook_reraises_on_failure(monkeypatch):
    monkeypatch.setattr(
        organizations_service_module,
        "get_wallets_service",
        lambda: _FailingWalletsService(),
    )

    with pytest.raises(RuntimeError):
        await organizations_service_module._award_signup_grant(organization_id=uuid4())


@pytest.mark.asyncio
async def test_provision_signup_subscription_awards_signup_grant_after_balance(
    monkeypatch,
):
    """B3: `provision_signup_subscription` must call the balance-provisioning hook
    BEFORE the signup-grant hook — a credit with no balance row to project into is a
    bug. Also proves the signup grant is wired on the signup path specifically."""
    call_order = []

    async def _fake_provision_wallet_general_balance(*, organization_id, plan):
        call_order.append("provision")

    async def _fake_award_signup_grant(*, organization_id):
        call_order.append("award")

    class _FakeSubscription:
        plan = "cloud_v0_hobby"
        anchor = None

    class _FakeSubscriptionService:
        async def provision_subscription(
            self, *, organization_id, organization_name, organization_email
        ):
            return _FakeSubscription()

    class _FakeOrganization:
        id = uuid4()
        name = "acme"

    monkeypatch.setattr(
        organizations_service_module,
        "_provision_wallet_general_balance",
        _fake_provision_wallet_general_balance,
    )
    monkeypatch.setattr(
        organizations_service_module,
        "_award_signup_grant",
        _fake_award_signup_grant,
    )
    monkeypatch.setattr(
        organizations_service_module,
        "_subscription_service",
        _FakeSubscriptionService(),
    )

    async def _fake_check_entitlements(*, key, delta, scope):
        return None

    monkeypatch.setattr(
        organizations_service_module, "check_entitlements", _fake_check_entitlements
    )

    await organizations_service_module.provision_signup_subscription(
        _FakeOrganization(), organization_email="user@example.com"
    )

    assert call_order == ["provision", "award"]


@pytest.mark.asyncio
async def test_provision_user_subscription_never_awards_signup_grant(monkeypatch):
    """Report.md §9.2: grant on the signup path only, never on explicit organization
    creation, or it is farmable. `provision_user_subscription` (the `POST
    /organizations/` entry point) must not call `_award_signup_grant` at all."""
    awarded = []

    async def _fake_award_signup_grant(*, organization_id):
        awarded.append(organization_id)

    async def _fake_provision_wallet_general_balance(*, organization_id, plan):
        return None

    class _FakeOrganization:
        id = uuid4()
        name = "acme"

    monkeypatch.setattr(
        organizations_service_module,
        "_award_signup_grant",
        _fake_award_signup_grant,
    )
    monkeypatch.setattr(
        organizations_service_module,
        "_provision_wallet_general_balance",
        _fake_provision_wallet_general_balance,
    )
    monkeypatch.setattr(
        organizations_service_module._subscription_service,
        "start_plan",
        lambda *, organization_id, plan: _AwaitableNone(),
    )

    async def _fake_check_entitlements(*, key, delta, scope):
        return None

    monkeypatch.setattr(
        organizations_service_module, "check_entitlements", _fake_check_entitlements
    )

    await organizations_service_module.provision_user_subscription(_FakeOrganization())

    assert awarded == []  # never called on the explicit-creation path


class _AwaitableNone:
    def __await__(self):
        async def _coro():
            return None

        return _coro().__await__()


@pytest.mark.asyncio
async def test_provision_signup_subscription_skips_wallet_when_flag_off(monkeypatch):
    """AGENTA_WALLETS_ENABLED off (the default) must keep both wallet hooks out of the
    signup path entirely. Both re-raise, and the signup flow deletes the new user when
    this coroutine fails, so an unfinished wallet would cost real signups; skipping also
    means no balance row or grant is written that a corrected ledger has to undo."""
    monkeypatch.setattr(env.wallets, "enabled", False)

    provisioned = []
    awarded = []

    async def _fake_provision_wallet_general_balance(*, organization_id, plan):
        provisioned.append(organization_id)

    async def _fake_award_signup_grant(*, organization_id):
        awarded.append(organization_id)

    class _FakeSubscription:
        plan = "cloud_v0_hobby"
        anchor = None

    class _FakeSubscriptionService:
        async def provision_subscription(
            self, *, organization_id, organization_name, organization_email
        ):
            return _FakeSubscription()

    class _FakeOrganization:
        id = uuid4()
        name = "acme"

    monkeypatch.setattr(
        organizations_service_module,
        "_provision_wallet_general_balance",
        _fake_provision_wallet_general_balance,
    )
    monkeypatch.setattr(
        organizations_service_module,
        "_award_signup_grant",
        _fake_award_signup_grant,
    )
    monkeypatch.setattr(
        organizations_service_module,
        "_subscription_service",
        _FakeSubscriptionService(),
    )

    async def _fake_check_entitlements(*, key, delta, scope):
        return None

    monkeypatch.setattr(
        organizations_service_module, "check_entitlements", _fake_check_entitlements
    )

    await organizations_service_module.provision_signup_subscription(
        _FakeOrganization(), organization_email="user@example.com"
    )

    assert provisioned == []
    assert awarded == []


@pytest.mark.asyncio
async def test_retried_signup_sizes_the_wallet_from_the_stored_plan(monkeypatch):
    """`provision_subscription` returns None when the organization already has a
    subscription, which is what a retried signup looks like. The wallet's floor is sized
    from the plan, so falling back to `get_default_plan()` there would provision an
    organization that Stripe put on the trial plan as though it were on the default one.
    The stored subscription is the only thing that knows which plan is real."""
    import ee.src.core.organizations.service as organizations_service_module

    provisioned_plans = []

    async def _fake_provision_wallet_general_balance(*, organization_id, plan):
        provisioned_plans.append(plan)

    async def _fake_award_signup_grant(*, organization_id):
        return None

    class _StoredSubscription:
        plan = "cloud_v0_trial"
        anchor = None

    class _FakeSubscriptionService:
        async def provision_subscription(
            self, *, organization_id, organization_name, organization_email
        ):
            return None  # already subscribed — this is the retry

        async def read(self, *, organization_id):
            return _StoredSubscription()

    class _FakeOrganization:
        id = uuid4()
        name = "acme"

    monkeypatch.setattr(
        organizations_service_module,
        "_provision_wallet_general_balance",
        _fake_provision_wallet_general_balance,
    )
    monkeypatch.setattr(
        organizations_service_module, "_award_signup_grant", _fake_award_signup_grant
    )
    monkeypatch.setattr(
        organizations_service_module,
        "_subscription_service",
        _FakeSubscriptionService(),
    )

    async def _fake_check_entitlements(*, key, delta, scope):
        return None

    monkeypatch.setattr(
        organizations_service_module, "check_entitlements", _fake_check_entitlements
    )

    await organizations_service_module.provision_signup_subscription(
        _FakeOrganization(), organization_email="user@example.com"
    )

    assert provisioned_plans == ["cloud_v0_trial"]
