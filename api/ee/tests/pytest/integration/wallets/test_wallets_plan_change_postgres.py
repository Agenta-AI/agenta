"""Real-Postgres coverage for the rule that a plan change writes nothing to the wallet.

An upgrade, a downgrade or a cancellation changes only which allowance the organization
gets from the next billing period on. Credit already granted keeps its amount, its
balance and its expiry (open-designs items 22 and 23). The subscription lifecycle runs
through the real `SubscriptionsService` with the real wallet service wired in, the way
the billing router builds it, so a regression that reconnects the two shows up here.
"""

import asyncio
import uuid
from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest
from alembic import command
from sqlalchemy import text

import ee.src.core.subscriptions.service as subscriptions_service_module
import oss.src.dbs.postgres.shared.engine as engine_module
from ee.databases.postgres.migrations.core_ee.utils import alembic_cfg
from ee.src.core.access.entitlements.types import DefaultPlan
from ee.src.core.subscriptions.service import SubscriptionsService
from ee.src.core.subscriptions.types import Event, SubscriptionDTO
from ee.src.core.wallets.grants import SIGNUP_GRANT_AMOUNT_MUSD
from ee.src.core.wallets.service import WalletsService
from ee.src.dbs.postgres.wallets.dao import WalletsDAO
from oss.src.dbs.postgres.shared.engine import get_transactions_engine
from oss.src.utils.env import env

pytestmark = [
    pytest.mark.asyncio,
    pytest.mark.integration,
    pytest.mark.xdist_group(name="wallets-integration"),
]

DOWN_REVISION = "ee0000000003"
SCHEMA_REVISION = "ee0000000004"

HOBBY = DefaultPlan.CLOUD_V0_HOBBY.value
PRO = DefaultPlan.CLOUD_V0_PRO.value
BUSINESS = DefaultPlan.CLOUD_V0_BUSINESS.value


@pytest.fixture(autouse=True)
async def _fresh_engine_per_test():
    engine_module._transactions_engine = None
    yield
    if engine_module._transactions_engine is not None:
        await engine_module._transactions_engine.close()
        engine_module._transactions_engine = None


@pytest.fixture
async def wallet_schema():
    await asyncio.to_thread(command.upgrade, alembic_cfg, SCHEMA_REVISION)
    try:
        yield
    finally:
        await asyncio.to_thread(command.downgrade, alembic_cfg, DOWN_REVISION)


class _InMemorySubscriptionsDAO:
    def __init__(self, subscription: SubscriptionDTO):
        self.subscription = subscription

    async def read(self, *, organization_id):
        return self.subscription

    async def update(self, *, subscription):
        self.subscription = subscription
        return subscription


def _fake_stripe():
    """Enough of the Stripe client for a plan switch: the subscription exists, and
    modifying its items succeeds."""
    return SimpleNamespace(
        Subscription=SimpleNamespace(
            retrieve=lambda id: SimpleNamespace(id=id),
            modify=lambda *args, **kwargs: None,
        ),
        SubscriptionItem=SimpleNamespace(
            list=lambda subscription: SimpleNamespace(data=[]),
        ),
    )


async def _wallet_rows(organization_id: uuid.UUID) -> dict:
    """Every wallet row of the organization, with the fields a plan change could touch."""
    async with get_transactions_engine().session() as session:
        params = {"organization_id": organization_id}
        credits = (
            await session.execute(
                text(
                    "SELECT id, credit_kind, amount_musd, start_time, end_time "
                    "FROM wallet_credits WHERE organization_id = :organization_id "
                    "ORDER BY id"
                ),
                params,
            )
        ).all()
        balances = (
            await session.execute(
                text(
                    "SELECT id, wallet_credit_id, balance_musd, floor_musd "
                    "FROM wallet_balances WHERE organization_id = :organization_id "
                    "ORDER BY id"
                ),
                params,
            )
        ).all()
        debits = (
            await session.execute(
                text(
                    "SELECT id FROM wallet_debits "
                    "WHERE organization_id = :organization_id"
                ),
                params,
            )
        ).all()
    return {"credits": credits, "balances": balances, "debits": debits}


async def _cleanup(organization_id: uuid.UUID):
    async with get_transactions_engine().session() as session:
        for table in ("wallet_debits", "wallet_balances", "wallet_credits"):
            await session.execute(
                text(f"DELETE FROM {table} WHERE organization_id = :organization_id"),
                {"organization_id": organization_id},
            )


async def test_plan_changes_write_no_wallet_rows_and_granted_credit_survives(
    wallet_schema, monkeypatch
):
    monkeypatch.setattr(env.wallets, "enabled", True)
    monkeypatch.setattr(subscriptions_service_module, "invalidate_cache", AsyncMock())
    monkeypatch.setattr(subscriptions_service_module, "_load_stripe", _fake_stripe)

    organization_id = uuid.uuid4()
    wallets_service = WalletsService(wallets_dao=WalletsDAO())
    subscriptions_dao = _InMemorySubscriptionsDAO(
        SubscriptionDTO(
            organization_id=str(organization_id),
            plan=HOBBY,
            active=True,
            anchor=1,
        )
    )
    subscriptions_service = SubscriptionsService(
        subscriptions_dao=subscriptions_dao,
        wallets_service=wallets_service,
    )

    try:
        await wallets_service.provision_general_balance(
            organization_id=organization_id, plan=HOBBY
        )
        signup_credit = await wallets_service.award(
            organization_id=organization_id, activity_code="signup"
        )
        before = await _wallet_rows(organization_id)

        # Upgrade, upgrade again, downgrade, then cancel back to the free plan.
        changes = [
            dict(
                event=Event.SUBSCRIPTION_CREATED,
                subscription_id="sub_123",
                plan=PRO,
            ),
            dict(event=Event.SUBSCRIPTION_SWITCHED, plan=BUSINESS),
            dict(event=Event.SUBSCRIPTION_SWITCHED, plan=PRO),
            dict(event=Event.SUBSCRIPTION_CANCELLED),
        ]
        for change in changes:
            await subscriptions_service.process_event(
                organization_id=str(organization_id), **change
            )
            assert await _wallet_rows(organization_id) == before

        # The subscription moved through every plan; the wallet did not.
        assert subscriptions_dao.subscription.plan == HOBBY
        assert before["debits"] == []
        (credit,) = before["credits"]
        assert credit.id == signup_credit.id
        assert credit.end_time == signup_credit.end_time

        # The granted credit stays spendable after the cancellation, until its expiry.
        spendable = await WalletsDAO().get_spendable_balance(
            organization_id=organization_id
        )
        assert spendable.spendable_musd == SIGNUP_GRANT_AMOUNT_MUSD
        assert await wallets_service.check(organization_id=organization_id) is True
    finally:
        await _cleanup(organization_id)
