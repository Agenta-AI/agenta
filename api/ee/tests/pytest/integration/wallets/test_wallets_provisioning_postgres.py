"""Real-Postgres coverage for `WalletsDAO.provision_general_balance` — the B1
provisioning flow from WP-1-04. Unit tests in
`ee/tests/pytest/unit/wallets/test_wallets_provisioning.py` cover the same behavior
against the in-memory `FakeWalletsDAO`; this file proves the real DAO's `ON CONFLICT DO
NOTHING` (partial unique index) and locking/replay-guard logic actually hold against
Postgres — a compiled-SQL-only unit test cannot prove either.

Self-skips via `conftest.py` when `env.postgres.uri_core` is unreachable. WRITTEN BUT NOT
RUN — see `docs/design/wallets-research/v1/nodes/im-1-02-pipeline/acceptance.md`.
"""

import asyncio
import uuid
from datetime import datetime, timedelta, timezone

import pytest
from alembic import command
from sqlalchemy import text

import oss.src.dbs.postgres.shared.engine as engine_module
from ee.databases.postgres.migrations.core_ee.utils import alembic_cfg
from ee.src.dbs.postgres.wallets.dao import WalletsDAO
from oss.src.dbs.postgres.shared.engine import get_transactions_engine

# One xdist group for the whole wallet pipeline: these modules churn the shared alembic
# chain, the process-wide engine singleton, and the wallet Redis streams, so they are only
# correct on a single worker under `pytest.ini`'s default `-n auto --dist=loadgroup`.
pytestmark = [
    pytest.mark.asyncio,
    pytest.mark.integration,
    pytest.mark.xdist_group(name="wallets-integration"),
]

DOWN_REVISION = "ee0000000003"
# Schema only (wallet tables) — the ee0000000005 backfill migration is not needed for
# these DAO-level tests and would otherwise scan the whole shared `organizations` table
# unnecessarily.
SCHEMA_REVISION = "ee0000000004"

PERIOD_START = datetime(2026, 1, 1, tzinfo=timezone.utc)
PERIOD_END = datetime(2026, 2, 1, tzinfo=timezone.utc)
# Every expiry decision below is made against this injected instant, never the database
# clock, so the fixed period above cannot go stale as wall-clock time passes it.
NOW = PERIOD_START + timedelta(days=21)


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
