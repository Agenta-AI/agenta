"""Real-Postgres coverage for the wallet's credit sources: the daily free credits under
concurrent admissions, and the monthly and purchased credits under redelivery.

Self-skips via `conftest.py` when `env.postgres.uri_core` is unreachable.
"""

import asyncio
import uuid
from datetime import datetime, timedelta, timezone

import pytest
from alembic import command
from sqlalchemy import text

import oss.src.dbs.postgres.shared.engine as engine_module
from ee.databases.postgres.migrations.core_ee.utils import alembic_cfg
from ee.src.core.access.entitlements.types import DefaultPlan
from ee.src.core.wallets.grants import DAILY_FREE_CREDITS_MUSD, next_utc_midnight
from ee.src.core.wallets.service import WalletsService
from ee.src.dbs.postgres.wallets.dao import WalletsDAO
from oss.src.dbs.postgres.shared.engine import get_transactions_engine

pytestmark = [
    pytest.mark.asyncio,
    pytest.mark.integration,
    pytest.mark.xdist_group(name="wallets-integration"),
]

DOWN_REVISION = "ee0000000003"
SCHEMA_REVISION = "ee0000000004"

HOBBY = DefaultPlan.CLOUD_V0_HOBBY.value
PRO = DefaultPlan.CLOUD_V0_PRO.value


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


async def _credits(organization_id, credit_kind):
    async with get_transactions_engine().session() as session:
        return (
            await session.execute(
                text(
                    "SELECT amount_musd, start_time, end_time FROM wallet_credits"
                    " WHERE organization_id = :id AND credit_kind = :kind"
                    " ORDER BY start_time"
                ),
                {"id": organization_id, "kind": credit_kind},
            )
        ).all()


async def _general_balance(organization_id):
    async with get_transactions_engine().session() as session:
        return (
            await session.execute(
                text(
                    "SELECT balance_musd FROM wallet_balances"
                    " WHERE organization_id = :id AND wallet_credit_id IS NULL"
                ),
                {"id": organization_id},
            )
        ).scalar_one()


async def _cleanup(*organization_ids):
    async with get_transactions_engine().session() as session:
        for organization_id in organization_ids:
            for table in ("wallet_debits", "wallet_balances", "wallet_credits"):
                await session.execute(
                    text(f"DELETE FROM {table} WHERE organization_id = :id"),
                    {"id": organization_id},
                )


def _plan_reader(plan):
    async def read(_organization_id):
        return plan

    return read


async def test_concurrent_first_admissions_grant_one_daily_credit(wallet_schema):
    organization_id = uuid.uuid4()
    try:
        # Four API processes, each with its own memo, admitting at once.
        services = [
            WalletsService(wallets_dao=WalletsDAO(), plan_reader=_plan_reader(HOBBY))
            for _ in range(4)
        ]
        results = await asyncio.gather(
            *(service.check(organization_id=organization_id) for service in services)
        )

        assert all(results)
        [credit] = await _credits(organization_id, "daily_free")
        assert credit.amount_musd == DAILY_FREE_CREDITS_MUSD
        assert credit.end_time == next_utc_midnight(credit.start_time)
        assert await _general_balance(organization_id) == DAILY_FREE_CREDITS_MUSD
    finally:
        await _cleanup(organization_id)


async def test_an_expired_daily_credit_is_not_spendable(wallet_schema):
    organization_id = uuid.uuid4()
    service = WalletsService(wallets_dao=WalletsDAO())
    try:
        yesterday = datetime.now(timezone.utc) - timedelta(days=1)
        await service.award(
            organization_id=organization_id,
            activity_code="daily_free",
            reference=yesterday.date().isoformat(),
            now=yesterday,
        )

        assert await _general_balance(organization_id) == DAILY_FREE_CREDITS_MUSD
        assert await service.check(organization_id=organization_id) is False
    finally:
        await _cleanup(organization_id)


async def test_a_redelivered_renewal_grants_the_period_once(wallet_schema):
    organization_id = uuid.uuid4()
    service = WalletsService(wallets_dao=WalletsDAO())
    start = datetime.now(timezone.utc).replace(microsecond=0)
    period = dict(period_start=start, period_end=start + timedelta(days=30))
    try:
        await asyncio.gather(
            *(
                service.grant_period_allowance(
                    organization_id=organization_id, plan=PRO, **period
                )
                for _ in range(3)
            )
        )

        [credit] = await _credits(organization_id, "plan_allowance")
        assert credit.amount_musd == 29_000_000
        assert (credit.start_time, credit.end_time) == (
            period["period_start"],
            period["period_end"],
        )
        assert await _general_balance(organization_id) == 29_000_000
    finally:
        await _cleanup(organization_id)


async def test_a_redelivered_top_up_grants_once(wallet_schema):
    organization_id = uuid.uuid4()
    service = WalletsService(wallets_dao=WalletsDAO())
    try:
        for _ in range(2):
            await service.grant_purchase(
                organization_id=organization_id,
                checkout_session_id="cs_test_redelivered",
                amount_musd=10_000_000,
            )

        [credit] = await _credits(organization_id, "purchase")
        assert credit.end_time - credit.start_time == timedelta(days=365)
        assert await _general_balance(organization_id) == 10_000_000
    finally:
        await _cleanup(organization_id)
