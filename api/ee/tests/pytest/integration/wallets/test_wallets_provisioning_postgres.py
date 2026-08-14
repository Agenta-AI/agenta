"""Real-Postgres coverage for `WalletsDAO.provision_general_balance` and
`WalletsDAO.apply_plan_change` — the B1/B2 provisioning flows from WP-1-04. Unit tests in
`ee/tests/pytest/unit/wallets/test_wallets_provisioning.py` cover the same behavior
against the in-memory `FakeWalletsDAO`; this file proves the real DAO's `ON CONFLICT DO
NOTHING` (partial unique index) and locking/replay-guard logic actually hold against
Postgres — a compiled-SQL-only unit test cannot prove either.

Self-skips via `conftest.py` when `env.postgres.uri_core` is unreachable. WRITTEN BUT NOT
RUN — see `docs/design/wallets-research/v1/nodes/im-1-02-pipeline/acceptance.md`.
"""

import uuid
from datetime import datetime, timezone

import pytest
from alembic import command
from sqlalchemy import text

import oss.src.dbs.postgres.shared.engine as engine_module
from ee.databases.postgres.migrations.core_ee.utils import alembic_cfg
from ee.src.dbs.postgres.wallets.dao import WalletsDAO
from oss.src.dbs.postgres.shared.engine import get_transactions_engine

pytestmark = [pytest.mark.asyncio, pytest.mark.integration]

DOWN_REVISION = "ee0000000003"
# Schema only (wallet tables) — the ee0000000005 backfill migration is not needed for
# these DAO-level tests and would otherwise scan the whole shared `organizations` table
# unnecessarily.
SCHEMA_REVISION = "ee0000000004"

PERIOD_START = datetime(2026, 1, 1, tzinfo=timezone.utc)
PERIOD_END = datetime(2026, 2, 1, tzinfo=timezone.utc)


@pytest.fixture(autouse=True)
async def _fresh_engine_per_test():
    engine_module._transactions_engine = None
    yield
    if engine_module._transactions_engine is not None:
        await engine_module._transactions_engine.close()
        engine_module._transactions_engine = None


@pytest.fixture
async def wallet_schema():
    command.upgrade(alembic_cfg, SCHEMA_REVISION)
    try:
        yield
    finally:
        command.downgrade(alembic_cfg, DOWN_REVISION)


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


async def test_provision_general_balance_is_idempotent_against_real_conflict(
    wallet_schema,
):
    organization_id = uuid.uuid4()
    dao = WalletsDAO()

    try:
        await dao.provision_general_balance(
            organization_id=organization_id, floor_musd=-1000
        )
        # Second call races the SAME partial unique index the first call already
        # satisfied — this is the actual ON CONFLICT DO NOTHING path, not an
        # application-level check-then-insert.
        await dao.provision_general_balance(
            organization_id=organization_id, floor_musd=-1000
        )

        general = await dao.get_general_balance(organization_id=organization_id)
        assert general is not None
        assert general.balance_musd == 0
        assert general.floor_musd == -1000

        engine = get_transactions_engine()
        async with engine.session() as session:
            result = await session.execute(
                text(
                    "SELECT count(*) FROM wallet_balances "
                    "WHERE organization_id = :organization_id AND wallet_credit_id IS NULL"
                ),
                {"organization_id": organization_id},
            )
            assert result.scalar() == 1
    finally:
        await _cleanup(organization_id)


async def test_apply_plan_change_mints_credit_and_debits_outgoing_against_real_db(
    wallet_schema,
):
    organization_id = uuid.uuid4()
    dao = WalletsDAO()

    try:
        await dao.provision_general_balance(organization_id=organization_id)

        # Seed an outgoing plan_allowance credit + its balance row directly (mirrors how
        # a prior plan change or a future allowance-issuance job would have created it).
        outgoing_credit_id = uuid.uuid4()
        engine = get_transactions_engine()
        async with engine.session() as session:
            await session.execute(
                text(
                    "INSERT INTO wallet_credits "
                    "(id, organization_id, credit_kind, amount_musd, priority, end_time) "
                    "VALUES (:id, :organization_id, 'plan_allowance', 310000, 10, :end_time)"
                ),
                {
                    "id": outgoing_credit_id,
                    "organization_id": organization_id,
                    "end_time": PERIOD_END,
                },
            )
            await session.execute(
                text(
                    "INSERT INTO wallet_balances "
                    "(id, organization_id, wallet_credit_id, balance_musd) "
                    "VALUES (:id, :organization_id, :credit_id, 310000)"
                ),
                {
                    "id": uuid.uuid4(),
                    "organization_id": organization_id,
                    "credit_id": outgoing_credit_id,
                },
            )

        found_credit = await dao.get_active_plan_allowance_credit(
            organization_id=organization_id
        )
        assert found_credit is not None
        assert found_credit.id == outgoing_credit_id

        result = await dao.apply_plan_change(
            organization_id=organization_id,
            idempotency_key="pg-integration-plan-change",
            outgoing_credit_id=outgoing_credit_id,
            outgoing_debit_amount_musd=100_000,  # 10/31 of 310_000
            incoming_credit_kind="plan_allowance",
            incoming_credit_amount_musd=200_000,
            incoming_priority=10,
            incoming_end_time=PERIOD_END,
            floor_musd=-500,
            now=datetime(2026, 1, 22, tzinfo=timezone.utc),
        )

        assert result.replayed is False
        assert result.outgoing_debit_amount_musd == 100_000
        assert result.incoming_credit_amount_musd == 200_000
        assert result.incoming_credit_id is not None
        assert result.incoming_credit_id != outgoing_credit_id

        general = await dao.get_general_balance(organization_id=organization_id)
        assert general.balance_musd == 200_000 - 100_000
        assert general.floor_musd == -500

        async with engine.session() as session:
            outgoing_balance = await session.execute(
                text(
                    "SELECT balance_musd FROM wallet_balances "
                    "WHERE wallet_credit_id = :credit_id"
                ),
                {"credit_id": outgoing_credit_id},
            )
            assert outgoing_balance.scalar() == 310_000 - 100_000

            # The outgoing credit's OWN immutable row is untouched.
            outgoing_credit_row = await session.execute(
                text(
                    "SELECT amount_musd, credit_kind FROM wallet_credits WHERE id = :id"
                ),
                {"id": outgoing_credit_id},
            )
            amount_musd, credit_kind = outgoing_credit_row.one()
            assert amount_musd == 310_000
            assert credit_kind == "plan_allowance"

        # Replay: the exact same idempotency_key must produce no second effect, even
        # with different amounts passed in (simulating `now` drift on redelivery).
        replay = await dao.apply_plan_change(
            organization_id=organization_id,
            idempotency_key="pg-integration-plan-change",
            outgoing_credit_id=outgoing_credit_id,
            outgoing_debit_amount_musd=999_999,
            incoming_credit_kind="plan_allowance",
            incoming_credit_amount_musd=999_999,
            incoming_priority=10,
            incoming_end_time=PERIOD_END,
            floor_musd=-500,
            now=datetime(2026, 1, 25, tzinfo=timezone.utc),
        )
        assert replay.replayed is True
        assert replay.incoming_credit_id == result.incoming_credit_id

        general_after_replay = await dao.get_general_balance(
            organization_id=organization_id
        )
        assert general_after_replay.balance_musd == general.balance_musd
    finally:
        await _cleanup(organization_id)
