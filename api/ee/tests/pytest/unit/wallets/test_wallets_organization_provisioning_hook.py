"""Unit tests for the B1 wiring: `ee.src.core.organizations.service.
_provision_wallet_general_balance` is the hook both `provision_signup_subscription` and
`provision_user_subscription` call after organization/subscription creation. Idempotency
of the underlying provisioning itself is tested at the wallets layer in
`test_wallets_provisioning.py`; this file covers only the organizations-service call
site: that it is called, with the right args, unconditionally on every call (idempotent
by construction one layer down), and that a failure propagates rather than being
silently swallowed (organization creation should surface a provisioning bug, not hide
it).
"""

from uuid import uuid4

import pytest

import ee.src.core.organizations.service as organizations_service_module


class _RecordingWalletsService:
    def __init__(self):
        self.calls = []

    async def provision_general_balance(self, *, organization_id, plan):
        self.calls.append((organization_id, plan))


class _FailingWalletsService:
    async def provision_general_balance(self, *, organization_id, plan):
        raise RuntimeError("simulated provisioning failure")


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
