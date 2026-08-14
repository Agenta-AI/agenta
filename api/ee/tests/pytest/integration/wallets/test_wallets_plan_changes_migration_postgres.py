"""Real-Postgres coverage for the `ee0000000005` migration (`wallet_plan_changes`
idempotency ledger): it applies (and round-trips upgrade -> downgrade -> upgrade), and its
unique/FK constraints hold at the database level.

Self-skips via `conftest.py` when `env.postgres.uri_core` is unreachable. WRITTEN BUT NOT
RUN — see `docs/design/wallets-research/v1/nodes/im-1-02-pipeline/acceptance.md`.
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

DOWN_REVISION = "ee0000000004"
REVISION = "ee0000000005"


@pytest.fixture(autouse=True)
async def _fresh_engine_per_test():
    engine_module._transactions_engine = None
    yield
    if engine_module._transactions_engine is not None:
        await engine_module._transactions_engine.close()
        engine_module._transactions_engine = None


@pytest.fixture
async def plan_changes_schema():
    """Apply through `ee0000000005` (wallet tables + the new ledger table), and always
    leave the database exactly as found afterward."""
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


async def _insert_ledger_row(session, *, organization_id, idempotency_key):
    row_id = uuid.uuid4()
    await session.execute(
        text(
            "INSERT INTO wallet_plan_changes "
            "(id, organization_id, idempotency_key) "
            "VALUES (:id, :org, :key)"
        ),
        {"id": row_id, "org": organization_id, "key": idempotency_key},
    )
    return row_id


async def test_migration_upgrade_downgrade_upgrade_round_trip():
    assert not await _table_exists("wallet_plan_changes")

    command.upgrade(alembic_cfg, REVISION)
    try:
        assert await _table_exists("wallet_plan_changes")

        command.downgrade(alembic_cfg, DOWN_REVISION)
        assert not await _table_exists("wallet_plan_changes")

        command.upgrade(alembic_cfg, REVISION)
        assert await _table_exists("wallet_plan_changes")
    finally:
        command.downgrade(alembic_cfg, DOWN_REVISION)


async def test_partial_unique_one_row_per_organization_and_idempotency_key(
    plan_changes_schema,
):
    organization_id = uuid.uuid4()
    engine = get_transactions_engine()

    async with engine.session() as session:
        await _insert_ledger_row(
            session, organization_id=organization_id, idempotency_key="pc-1"
        )

    with pytest.raises(IntegrityError):
        async with engine.session() as session:
            await _insert_ledger_row(
                session, organization_id=organization_id, idempotency_key="pc-1"
            )


async def test_same_idempotency_key_is_fine_for_a_different_organization(
    plan_changes_schema,
):
    engine = get_transactions_engine()

    async with engine.session() as session:
        await _insert_ledger_row(
            session, organization_id=uuid.uuid4(), idempotency_key="pc-shared"
        )
        # Different organization, same key string — no collision, the unique
        # constraint is scoped by (organization_id, idempotency_key) together.
        await _insert_ledger_row(
            session, organization_id=uuid.uuid4(), idempotency_key="pc-shared"
        )


async def test_outgoing_credit_fk_is_restrict_not_cascade(plan_changes_schema):
    organization_id = uuid.uuid4()
    engine = get_transactions_engine()

    async with engine.session() as session:
        credit_id = uuid.uuid4()
        await session.execute(
            text(
                "INSERT INTO wallet_credits "
                "(id, organization_id, credit_kind, amount_musd, priority) "
                "VALUES (:id, :org, 'plan_allowance', 1000, 10)"
            ),
            {"id": credit_id, "org": organization_id},
        )
        await session.execute(
            text(
                "INSERT INTO wallet_plan_changes "
                "(id, organization_id, idempotency_key, outgoing_credit_id) "
                "VALUES (:id, :org, 'pc-fk', :credit_id)"
            ),
            {"id": uuid.uuid4(), "org": organization_id, "credit_id": credit_id},
        )

    with pytest.raises(IntegrityError):
        async with engine.session() as session:
            await session.execute(
                text("DELETE FROM wallet_credits WHERE id = :id"), {"id": credit_id}
            )
