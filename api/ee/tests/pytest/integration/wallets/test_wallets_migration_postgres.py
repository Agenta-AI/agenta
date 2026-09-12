"""Real-Postgres coverage for the `ee0000000004` wallet migration: it applies (and
round-trips upgrade -> downgrade -> upgrade), and its FK / partial-unique / uniqueness
constraints actually hold at the database level (a compiled-SQL-only unit test cannot prove
this — see `oss/tests/pytest/integration/sessions/test_sessions_query_postgres.py` for the
same rationale in a sibling domain).

Self-skips via `conftest.py` when `env.postgres.uri_core` is unreachable.
"""

import uuid

import pytest
from alembic import command
from sqlalchemy import text
from sqlalchemy.exc import IntegrityError

import oss.src.dbs.postgres.shared.engine as engine_module
from ee.databases.postgres.migrations.core_ee.utils import alembic_cfg
from oss.src.dbs.postgres.shared.engine import get_transactions_engine

pytestmark = [pytest.mark.asyncio, pytest.mark.integration]

DOWN_REVISION = "ee0000000003"
REVISION = "ee0000000004"


@pytest.fixture(autouse=True)
async def _fresh_engine_per_test():
    engine_module._transactions_engine = None
    yield
    if engine_module._transactions_engine is not None:
        await engine_module._transactions_engine.close()
        engine_module._transactions_engine = None


@pytest.fixture
async def wallet_schema():
    """Apply the wallet migration for the test, and always leave the database exactly as
    found (downgraded back to `ee0000000003`) afterward — this DB may be shared with other
    work, and this package does not own deploying it."""
    command.upgrade(alembic_cfg, REVISION)
    try:
        yield
    finally:
        command.downgrade(alembic_cfg, DOWN_REVISION)


async def _table_exists(name: str) -> bool:
    engine = get_transactions_engine()
    async with engine.session() as session:
        result = await session.execute(
            text("SELECT to_regclass(:name) IS NOT NULL"), {"name": f"public.{name}"}
        )
        return bool(result.scalar())


def _seed_organization_row_owner() -> uuid.UUID:
    """Wallet tables use a validated logical `organization_id`, not a real FK — no
    `organizations` row is required to insert wallet rows. Just mint an id."""
    return uuid.uuid4()


async def _insert_general_balance(
    session, *, organization_id, balance_musd=100_000, floor_musd=0
):
    balance_id = uuid.uuid4()
    await session.execute(
        text(
            "INSERT INTO wallet_balances "
            "(id, organization_id, wallet_credit_id, balance_musd, floor_musd) "
            "VALUES (:id, :org, NULL, :balance, :floor)"
        ),
        {
            "id": balance_id,
            "org": organization_id,
            "balance": balance_musd,
            "floor": floor_musd,
        },
    )
    return balance_id


async def _insert_credit(
    session, *, organization_id, priority=10, end_time=None, amount_musd=500_000
):
    credit_id = uuid.uuid4()
    await session.execute(
        text(
            "INSERT INTO wallet_credits "
            "(id, organization_id, credit_kind, amount_musd, priority, end_time) "
            "VALUES (:id, :org, 'plan_allowance', :amount, :priority, :end_time)"
        ),
        {
            "id": credit_id,
            "org": organization_id,
            "amount": amount_musd,
            "priority": priority,
            "end_time": end_time,
        },
    )
    return credit_id


async def _insert_credit_balance(
    session, *, organization_id, wallet_credit_id, balance_musd
):
    balance_id = uuid.uuid4()
    await session.execute(
        text(
            "INSERT INTO wallet_balances "
            "(id, organization_id, wallet_credit_id, balance_musd, floor_musd) "
            "VALUES (:id, :org, :credit_id, :balance, NULL)"
        ),
        {
            "id": balance_id,
            "org": organization_id,
            "credit_id": wallet_credit_id,
            "balance": balance_musd,
        },
    )
    return balance_id


async def _insert_debit(
    session,
    *,
    organization_id,
    debit_key,
    idempotency_key=None,
    amount_musd=1000,
    wallet_credit_id=None,
    resource_key="llm:google:gemini-2.5-flash",
    pricing_version="wallet-v1-fake-llm-1",
):
    # Non-literal default: a hardcoded posting-key string next to `idempotency_key=`
    # false-positives the repo's generic-api-key gitleaks rule.
    if idempotency_key is None:
        idempotency_key = f"fixture-posting-{uuid.uuid4().hex}"
    debit_id = uuid.uuid4()
    await session.execute(
        text(
            "INSERT INTO wallet_debits "
            "(id, organization_id, debit_kind, amount_musd, wallet_credit_id, "
            " idempotency_key, debit_key, resource_key, pricing_version) "
            "VALUES (:id, :org, 'gateway_usage', :amount, :credit_id, "
            " :idem, :debit_key, :resource_key, :pricing_version)"
        ),
        {
            "id": debit_id,
            "org": organization_id,
            "amount": amount_musd,
            "credit_id": wallet_credit_id,
            "idem": idempotency_key,
            "debit_key": debit_key,
            "resource_key": resource_key,
            "pricing_version": pricing_version,
        },
    )
    return debit_id


async def test_migration_upgrade_downgrade_upgrade_round_trip():
    for table in ("wallet_credits", "wallet_debits", "wallet_balances"):
        assert not await _table_exists(table)

    command.upgrade(alembic_cfg, REVISION)
    try:
        for table in ("wallet_credits", "wallet_debits", "wallet_balances"):
            assert await _table_exists(table)

        command.downgrade(alembic_cfg, DOWN_REVISION)
        for table in ("wallet_credits", "wallet_debits", "wallet_balances"):
            assert not await _table_exists(table)

        command.upgrade(alembic_cfg, REVISION)
        for table in ("wallet_credits", "wallet_debits", "wallet_balances"):
            assert await _table_exists(table)
    finally:
        command.downgrade(alembic_cfg, DOWN_REVISION)


async def test_partial_unique_one_general_balance_row_per_organization(wallet_schema):
    organization_id = _seed_organization_row_owner()
    engine = get_transactions_engine()

    async with engine.session() as session:
        await _insert_general_balance(session, organization_id=organization_id)

    with pytest.raises(IntegrityError):
        async with engine.session() as session:
            await _insert_general_balance(session, organization_id=organization_id)


async def test_partial_unique_one_balance_row_per_credit(wallet_schema):
    organization_id = _seed_organization_row_owner()
    engine = get_transactions_engine()

    async with engine.session() as session:
        credit_id = await _insert_credit(session, organization_id=organization_id)
        await _insert_credit_balance(
            session,
            organization_id=organization_id,
            wallet_credit_id=credit_id,
            balance_musd=1000,
        )

    with pytest.raises(IntegrityError):
        async with engine.session() as session:
            await _insert_credit_balance(
                session,
                organization_id=organization_id,
                wallet_credit_id=credit_id,
                balance_musd=1000,
            )


async def test_debit_key_uniqueness_is_the_final_replay_guard(wallet_schema):
    organization_id = _seed_organization_row_owner()
    engine = get_transactions_engine()

    async with engine.session() as session:
        await _insert_debit(
            session,
            organization_id=organization_id,
            debit_key="test-fixture-posting-key:deficit",
        )

    with pytest.raises(IntegrityError):
        async with engine.session() as session:
            await _insert_debit(
                session,
                organization_id=organization_id,
                debit_key="test-fixture-posting-key:deficit",
            )


async def test_wallet_credit_fk_is_restrict_not_cascade(wallet_schema):
    organization_id = _seed_organization_row_owner()
    engine = get_transactions_engine()

    async with engine.session() as session:
        credit_id = await _insert_credit(session, organization_id=organization_id)
        await _insert_credit_balance(
            session,
            organization_id=organization_id,
            wallet_credit_id=credit_id,
            balance_musd=1000,
        )
        await _insert_debit(
            session,
            organization_id=organization_id,
            debit_key="test-fixture-posting-key:restrict",
            wallet_credit_id=credit_id,
        )

    with pytest.raises(IntegrityError):
        async with engine.session() as session:
            await session.execute(
                text("DELETE FROM wallet_credits WHERE id = :id"), {"id": credit_id}
            )


async def test_amount_musd_check_constraint_rejects_non_positive(wallet_schema):
    organization_id = _seed_organization_row_owner()
    engine = get_transactions_engine()

    with pytest.raises(IntegrityError):
        async with engine.session() as session:
            await _insert_debit(
                session,
                organization_id=organization_id,
                debit_key="test-fixture-posting-key:zero",
                amount_musd=0,
            )


async def test_all_or_nothing_rollback_on_settlement_failure(wallet_schema):
    """A settlement that fails partway through must leave no partial debit or balance
    change behind — the whole point of doing it in one transaction."""
    organization_id = _seed_organization_row_owner()
    engine = get_transactions_engine()

    async with engine.session() as session:
        await _insert_general_balance(
            session, organization_id=organization_id, balance_musd=100_000
        )
        credit_id = await _insert_credit(session, organization_id=organization_id)
        await _insert_credit_balance(
            session,
            organization_id=organization_id,
            wallet_credit_id=credit_id,
            balance_musd=5000,
        )

    with pytest.raises(IntegrityError):
        async with engine.session() as session:
            await _insert_debit(
                session,
                organization_id=organization_id,
                debit_key="test-fixture-posting-key:atomic",
                wallet_credit_id=credit_id,
                amount_musd=1000,
            )
            await session.execute(
                text(
                    "UPDATE wallet_balances SET balance_musd = balance_musd - 1000 "
                    "WHERE wallet_credit_id = :credit_id"
                ),
                {"credit_id": credit_id},
            )
            # Force a failure after two valid-looking writes: duplicate debit_key.
            await _insert_debit(
                session,
                organization_id=organization_id,
                debit_key="test-fixture-posting-key:atomic",
                wallet_credit_id=credit_id,
                amount_musd=1,
            )

    async with engine.session() as session:
        result = await session.execute(
            text(
                "SELECT balance_musd FROM wallet_balances WHERE wallet_credit_id = :credit_id"
            ),
            {"credit_id": credit_id},
        )
        assert result.scalar() == 5000  # unchanged — the whole transaction rolled back

        result = await session.execute(
            text("SELECT count(*) FROM wallet_debits WHERE organization_id = :org"),
            {"org": organization_id},
        )
        assert result.scalar() == 0
