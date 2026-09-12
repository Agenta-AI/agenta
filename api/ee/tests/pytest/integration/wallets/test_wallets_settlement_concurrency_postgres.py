"""Real-Postgres coverage for the replay invariant's concurrency guarantee: competing
deliveries cannot overspend one credit. This is the test the design cannot survive failing
— see `docs/design/wallets-research/v1/wave-1.md` §"Wallet replay invariant".

Drives `WalletsDAO.settle()` (not raw SQL) from several concurrent asyncio tasks, each its
own DB connection/transaction, all funded from one credit whose balance is smaller than the
combined requested amount. The organization general-balance row lock (acquired first, by
every settle() call) must serialize them so the credit's balance never goes negative and the
sum of what actually got funded from it never exceeds its starting balance.

Self-skips via `conftest.py` when `env.postgres.uri_core` is unreachable.
"""

import asyncio
import uuid
from datetime import datetime, timezone

import pytest
from alembic import command
from sqlalchemy import text

import oss.src.dbs.postgres.shared.engine as engine_module
from ee.databases.postgres.migrations.core_ee.utils import alembic_cfg
from ee.src.dbs.postgres.wallets.dao import WalletsDAO
from oss.src.dbs.postgres.shared.engine import (
    TransactionsEngine,
    get_transactions_engine,
)
from ee.tests.pytest.utils.wallets.builders import build_debit_command

pytestmark = [pytest.mark.asyncio, pytest.mark.integration]

DOWN_REVISION = "ee0000000003"
REVISION = "ee0000000004"

CREDIT_STARTING_BALANCE = 5000
CONCURRENT_POSTINGS = 8
AMOUNT_PER_POSTING = 1000  # 8 * 1000 = 8000 > 5000 available on the credit


@pytest.fixture(autouse=True)
async def _fresh_engine_per_test():
    engine_module._transactions_engine = None
    yield
    if engine_module._transactions_engine is not None:
        await engine_module._transactions_engine.close()
        engine_module._transactions_engine = None


@pytest.fixture
async def wallet_schema():
    command.upgrade(alembic_cfg, REVISION)
    try:
        yield
    finally:
        command.downgrade(alembic_cfg, DOWN_REVISION)


async def _seed_wallet(*, organization_id, credit_id):
    engine = get_transactions_engine()
    async with engine.session() as session:
        await session.execute(
            text(
                "INSERT INTO wallet_balances "
                "(id, organization_id, wallet_credit_id, balance_musd, floor_musd) "
                "VALUES (:id, :org, NULL, 0, -1000000)"
            ),
            {"id": uuid.uuid4(), "org": organization_id},
        )
        await session.execute(
            text(
                "INSERT INTO wallet_credits "
                "(id, organization_id, credit_kind, amount_musd, priority) "
                "VALUES (:id, :org, 'plan_allowance', :amount, 10)"
            ),
            {
                "id": credit_id,
                "org": organization_id,
                "amount": CREDIT_STARTING_BALANCE,
            },
        )
        await session.execute(
            text(
                "INSERT INTO wallet_balances "
                "(id, organization_id, wallet_credit_id, balance_musd, floor_musd) "
                "VALUES (:id, :org, :credit_id, :balance, NULL)"
            ),
            {
                "id": uuid.uuid4(),
                "org": organization_id,
                "credit_id": credit_id,
                "balance": CREDIT_STARTING_BALANCE,
            },
        )


async def test_competing_deliveries_cannot_overspend_one_credit(wallet_schema):
    organization_id = uuid.uuid4()
    credit_id = uuid.uuid4()
    await _seed_wallet(organization_id=organization_id, credit_id=credit_id)

    # Each posting gets its own DAO instance, its own TransactionsEngine, and therefore its
    # own DB connection — the closest a single test process gets to independent concurrent
    # settlement callers competing for the same credit.
    commands = [
        build_debit_command(
            organization_id=organization_id,
            idempotency_key=f"gw_concurrent_{i}",
            amount_musd=AMOUNT_PER_POSTING,
            created_at=datetime.now(timezone.utc),
        )
        for i in range(CONCURRENT_POSTINGS)
    ]

    async def _settle_with_own_connection(command_):
        engine = TransactionsEngine()
        try:
            dao = WalletsDAO(engine=engine)
            return await dao.settle(command=command_)
        finally:
            await engine.close()

    results = await asyncio.gather(
        *(_settle_with_own_connection(cmd) for cmd in commands)
    )

    total_funded_from_credit = 0
    total_deficit = 0
    for debits in results:
        for debit in debits:
            if debit.wallet_credit_id == credit_id:
                total_funded_from_credit += debit.amount_musd
            else:
                total_deficit += debit.amount_musd

    assert total_funded_from_credit <= CREDIT_STARTING_BALANCE
    assert (
        total_funded_from_credit + total_deficit
        == AMOUNT_PER_POSTING * CONCURRENT_POSTINGS
    )

    engine = get_transactions_engine()
    async with engine.session() as session:
        result = await session.execute(
            text(
                "SELECT balance_musd FROM wallet_balances WHERE wallet_credit_id = :credit_id"
            ),
            {"credit_id": credit_id},
        )
        remaining = result.scalar()
        assert remaining >= 0
        assert remaining == CREDIT_STARTING_BALANCE - total_funded_from_credit
