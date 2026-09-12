"""Real-Postgres coverage for lazy provisioning of the general balance row — the remedy
for open-designs item 14, where an organization created while `AGENTA_WALLETS_ENABLED` was
off holds no `wallet_balances` general row and nothing else ever gives it one.

Every wallet write path opens with `WalletsDAO._lock_general_balance`, which provisions the
row before locking it. Only Postgres can prove the two properties that matter: the insert
rides the caller's transaction (so a rolled-back settlement leaves no row behind), and
competing first deliveries end up sharing one row rather than racing the partial unique
index into a duplicate or a deadlock. Unit tests in
`ee/tests/pytest/unit/wallets/test_wallets_service.py` cover the same paths against the
in-memory `FakeWalletsDAO`.

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
from ee.src.core.wallets.plans import LAZY_PROVISION_FLOOR_MUSD
from ee.src.dbs.postgres.wallets.dao import WalletsDAO
from ee.tests.pytest.utils.wallets.builders import build_debit_command
from oss.src.dbs.postgres.shared.engine import (
    TransactionsEngine,
    get_transactions_engine,
)

# One xdist group for the whole wallet pipeline: these modules churn the shared alembic
# chain, the process-wide engine singleton, and the wallet Redis streams, so they are only
# correct on a single worker under `pytest.ini`'s default `-n auto --dist=loadgroup`.
pytestmark = [
    pytest.mark.asyncio,
    pytest.mark.integration,
    pytest.mark.xdist_group(name="wallets-integration"),
]

DOWN_REVISION = "ee0000000003"
SCHEMA_REVISION = "ee0000000004"

CONCURRENT_POSTINGS = 8
AMOUNT_PER_POSTING = 1000


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


async def _cleanup(organization_id: uuid.UUID):
    engine = get_transactions_engine()
    async with engine.session() as session:
        await session.execute(
            text("DELETE FROM wallet_debits WHERE organization_id = :organization_id"),
            {"organization_id": organization_id},
        )
        await session.execute(
            text(
                "DELETE FROM wallet_balances WHERE organization_id = :organization_id"
            ),
            {"organization_id": organization_id},
        )
        await session.execute(
            text("DELETE FROM wallet_credits WHERE organization_id = :organization_id"),
            {"organization_id": organization_id},
        )


async def _general_row_count(organization_id: uuid.UUID) -> int:
    engine = get_transactions_engine()
    async with engine.session() as session:
        result = await session.execute(
            text(
                "SELECT count(*) FROM wallet_balances "
                "WHERE organization_id = :organization_id AND wallet_credit_id IS NULL"
            ),
            {"organization_id": organization_id},
        )
        return result.scalar()


async def test_settle_provisions_the_missing_general_balance_and_posts_the_debit(
    wallet_schema,
):
    """The flag-gap case end to end: an organization with no wallet row at all receives a
    debit command. Before this change, `settle` raised
    `WalletGeneralBalanceNotFoundError` and the worker redelivered forever."""
    organization_id = uuid.uuid4()
    dao = WalletsDAO()

    try:
        assert await dao.get_general_balance(organization_id=organization_id) is None

        debits = await dao.settle(
            command=build_debit_command(
                organization_id=organization_id,
                idempotency_key="gw_first_posting_for_unprovisioned_org",
                amount_musd=AMOUNT_PER_POSTING,
                created_at=datetime.now(timezone.utc),
            )
        )

        general = await dao.get_general_balance(organization_id=organization_id)
        assert general is not None
        assert general.floor_musd == LAZY_PROVISION_FLOOR_MUSD
        # No credit funds this organization, so the posting is a deficit against the
        # general balance — one debit row, and the balance carries it.
        assert general.balance_musd == -AMOUNT_PER_POSTING
        assert [debit.amount_musd for debit in debits] == [AMOUNT_PER_POSTING]
        assert await _general_row_count(organization_id) == 1
    finally:
        await _cleanup(organization_id)


async def test_replaying_the_first_posting_provisions_nothing_further(wallet_schema):
    organization_id = uuid.uuid4()
    dao = WalletsDAO()
    command = build_debit_command(
        organization_id=organization_id,
        idempotency_key="gw_replayed_first_posting",
        amount_musd=AMOUNT_PER_POSTING,
        created_at=datetime.now(timezone.utc),
    )

    try:
        first = await dao.settle(command=command)
        second = await dao.settle(command=command)

        assert [debit.id for debit in second] == [debit.id for debit in first]
        general = await dao.get_general_balance(organization_id=organization_id)
        assert general.balance_musd == -AMOUNT_PER_POSTING  # one financial effect
        assert await _general_row_count(organization_id) == 1
    finally:
        await _cleanup(organization_id)


async def test_competing_first_deliveries_provision_exactly_one_general_balance(
    wallet_schema,
):
    """Several distinct postings for the same unprovisioned organization, settled
    concurrently on independent connections. Each one finds no row and tries to insert
    one; the partial unique index and the row lock must leave exactly one row and the
    correct total, not a duplicate, a lost update, or a deadlock."""
    organization_id = uuid.uuid4()
    commands = [
        build_debit_command(
            organization_id=organization_id,
            idempotency_key=f"gw_concurrent_lazy_{i}",
            amount_musd=AMOUNT_PER_POSTING,
            created_at=datetime.now(timezone.utc),
        )
        for i in range(CONCURRENT_POSTINGS)
    ]

    async def _settle_with_own_connection(command_):
        engine = TransactionsEngine()
        try:
            return await WalletsDAO(engine=engine).settle(command=command_)
        finally:
            await engine.close()

    try:
        results = await asyncio.gather(
            *(_settle_with_own_connection(cmd) for cmd in commands)
        )

        assert sum(len(debits) for debits in results) == CONCURRENT_POSTINGS
        assert await _general_row_count(organization_id) == 1

        general = await WalletsDAO().get_general_balance(
            organization_id=organization_id
        )
        assert general.balance_musd == -(CONCURRENT_POSTINGS * AMOUNT_PER_POSTING)
        assert general.floor_musd == LAZY_PROVISION_FLOOR_MUSD
    finally:
        await _cleanup(organization_id)


async def test_award_credit_provisions_the_missing_general_balance(wallet_schema):
    """The grant path has the same gap: an organization created while the flag was off
    never received its signup grant either, so the first award it is ever offered must not
    fail on a missing projection row."""
    organization_id = uuid.uuid4()
    dao = WalletsDAO()
    now = datetime.now(timezone.utc)

    try:
        credit = await dao.award_credit(
            organization_id=organization_id,
            idempotency_key="award:signup:organization:lazy",
            credit_kind="signup_grant",
            amount_musd=1_000_000,
            priority=20,
            end_time=now + timedelta(days=365),
            now=now,
        )

        general = await dao.get_general_balance(organization_id=organization_id)
        assert general.balance_musd == credit.amount_musd
        assert await _general_row_count(organization_id) == 1
    finally:
        await _cleanup(organization_id)


async def test_apply_plan_change_provisions_and_then_sets_the_plan_floor(wallet_schema):
    """Lazy provisioning starts the row at `LAZY_PROVISION_FLOOR_MUSD` because the path
    that provisions it does not know the plan. A plan change knows, and rewrites the
    floor — which is why no plan lookup belongs on the settlement path."""
    organization_id = uuid.uuid4()
    dao = WalletsDAO()
    period_start = datetime(2026, 1, 1, tzinfo=timezone.utc)
    period_end = datetime(2026, 2, 1, tzinfo=timezone.utc)

    try:
        result = await dao.apply_plan_change(
            organization_id=organization_id,
            idempotency_key="plan_change:lazy:2026-01-01",
            outgoing_credit_id=None,
            outgoing_debit_amount_musd=0,
            incoming_credit_kind="plan_allowance",
            incoming_credit_amount_musd=250_000,
            incoming_priority=10,
            incoming_end_time=period_end,
            floor_musd=-5_000,
            now=period_start + timedelta(days=10),
        )

        assert result.replayed is False
        general = await dao.get_general_balance(organization_id=organization_id)
        assert general.floor_musd == -5_000
        assert general.balance_musd == 250_000
        assert await _general_row_count(organization_id) == 1
    finally:
        await _cleanup(organization_id)


async def test_a_rolled_back_settlement_leaves_no_general_balance_row(
    wallet_schema, monkeypatch
):
    """The lazy insert rides the caller's transaction rather than committing on its own,
    so a settlement that fails after provisioning leaves the organization exactly as it
    was. The next delivery provisions again."""
    organization_id = uuid.uuid4()
    dao = WalletsDAO()

    def _explode(*args, **kwargs):
        raise RuntimeError("settlement planning failed after provisioning")

    try:
        monkeypatch.setattr("ee.src.dbs.postgres.wallets.dao.plan_settlement", _explode)

        with pytest.raises(RuntimeError):
            await dao.settle(
                command=build_debit_command(
                    organization_id=organization_id,
                    idempotency_key="gw_rolled_back",
                    amount_musd=AMOUNT_PER_POSTING,
                    created_at=datetime.now(timezone.utc),
                )
            )

        assert await _general_row_count(organization_id) == 0

        # And the next delivery heals it.
        monkeypatch.undo()
        await dao.settle(
            command=build_debit_command(
                organization_id=organization_id,
                idempotency_key="gw_after_rollback",
                amount_musd=AMOUNT_PER_POSTING,
                created_at=datetime.now(timezone.utc),
            )
        )
        assert await _general_row_count(organization_id) == 1
    finally:
        await _cleanup(organization_id)
