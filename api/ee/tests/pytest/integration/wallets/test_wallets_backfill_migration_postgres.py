"""Real-Postgres coverage for the `ee0000000005` backfill migration: it inserts a general
`wallet_balances` row for every existing organization that lacks one, is idempotent
(re-running inserts nothing new), and does not touch organizations that already have one
(from prior provisioning).

Inserts real rows into the shared `users`/`organizations` tables (adopted-OSS schema,
same physical database as `core_ee` — see `ee0000000002_adopt_oss_database.py`) and
always deletes them again in `finally`, regardless of test outcome — this database may be
shared with other work.

Self-skips via `conftest.py` when `env.postgres.uri_core` is unreachable. WRITTEN BUT NOT
RUN — see `docs/design/wallets-research/v1/nodes/im-1-02-pipeline/acceptance.md`.
"""

import uuid

import pytest
import uuid_utils.compat as uuid_utils
from alembic import command
from sqlalchemy import text

import oss.src.dbs.postgres.shared.engine as engine_module
from ee.databases.postgres.migrations.core_ee.utils import alembic_cfg
from oss.src.dbs.postgres.shared.engine import get_transactions_engine

pytestmark = [pytest.mark.asyncio, pytest.mark.integration]

DOWN_REVISION = "ee0000000004"  # pre-backfill: wallet tables only
BACKFILL_REVISION = "ee0000000005"


@pytest.fixture(autouse=True)
async def _fresh_engine_per_test():
    engine_module._transactions_engine = None
    yield
    if engine_module._transactions_engine is not None:
        await engine_module._transactions_engine.close()
        engine_module._transactions_engine = None


async def _insert_organization(session) -> uuid.UUID:
    """Minimal valid `organizations` row (its `owner_id` FK requires a `users` row).
    Both rows are logged for cleanup by the caller."""
    user_id = uuid.uuid4()
    unique = uuid.uuid4().hex
    await session.execute(
        text(
            "INSERT INTO users (id, uid, username, email) "
            "VALUES (:id, :uid, :username, :email)"
        ),
        {
            "id": user_id,
            "uid": unique,
            "username": f"wallet-backfill-fixture-{unique}",
            "email": f"wallet-backfill-fixture-{unique}@example.invalid",
        },
    )

    organization_id = uuid.uuid4()
    await session.execute(
        text(
            "INSERT INTO organizations (id, name, owner_id) "
            "VALUES (:id, :name, :owner_id)"
        ),
        {
            "id": organization_id,
            "name": f"wallet-backfill-fixture-{unique}",
            "owner_id": user_id,
        },
    )
    return organization_id, user_id


async def _cleanup(session, *, organization_ids, user_ids):
    for organization_id in organization_ids:
        await session.execute(
            text(
                "DELETE FROM wallet_balances WHERE organization_id = :organization_id"
            ),
            {"organization_id": organization_id},
        )
        await session.execute(
            text("DELETE FROM organizations WHERE id = :id"), {"id": organization_id}
        )
    for user_id in user_ids:
        await session.execute(text("DELETE FROM users WHERE id = :id"), {"id": user_id})


async def _general_balance_row_count(session, *, organization_id) -> int:
    result = await session.execute(
        text(
            "SELECT count(*) FROM wallet_balances "
            "WHERE organization_id = :organization_id AND wallet_credit_id IS NULL"
        ),
        {"organization_id": organization_id},
    )
    return result.scalar()


async def test_backfill_inserts_general_balance_for_organization_without_one():
    command.upgrade(alembic_cfg, DOWN_REVISION)  # wallet tables exist, no backfill yet
    engine = get_transactions_engine()
    organization_ids, user_ids = [], []

    try:
        async with engine.session() as session:
            organization_id, user_id = await _insert_organization(session)
            organization_ids.append(organization_id)
            user_ids.append(user_id)

        async with engine.session() as session:
            assert (
                await _general_balance_row_count(
                    session, organization_id=organization_id
                )
                == 0
            )

        command.upgrade(alembic_cfg, BACKFILL_REVISION)

        async with engine.session() as session:
            assert (
                await _general_balance_row_count(
                    session, organization_id=organization_id
                )
                == 1
            )

            result = await session.execute(
                text(
                    "SELECT balance_musd, floor_musd FROM wallet_balances "
                    "WHERE organization_id = :organization_id AND wallet_credit_id IS NULL"
                ),
                {"organization_id": organization_id},
            )
            balance_musd, floor_musd = result.one()
            assert balance_musd == 0
            assert floor_musd == 0  # floor_musd_for_plan is a constant 0 today
    finally:
        async with engine.session() as session:
            await _cleanup(
                session, organization_ids=organization_ids, user_ids=user_ids
            )
        command.downgrade(alembic_cfg, DOWN_REVISION)


async def test_backfill_is_idempotent_on_rerun():
    command.upgrade(alembic_cfg, DOWN_REVISION)
    engine = get_transactions_engine()
    organization_ids, user_ids = [], []

    try:
        async with engine.session() as session:
            organization_id, user_id = await _insert_organization(session)
            organization_ids.append(organization_id)
            user_ids.append(user_id)

        command.upgrade(alembic_cfg, BACKFILL_REVISION)

        # Alembic itself won't re-apply an already-applied revision, so the idempotency
        # test is re-executing the migration's own SELECT-then-INSERT a second time,
        # verbatim (Python-minted uuid7 id and all — see the migration's module
        # docstring) — this is the actual unit under test: the ON CONFLICT DO NOTHING /
        # NOT EXISTS guard, not alembic's version bookkeeping.
        async with engine.session() as session:
            rows = (
                await session.execute(
                    text(
                        """
                        SELECT o.id
                        FROM organizations o
                        LEFT JOIN subscriptions s ON s.organization_id = o.id
                        WHERE NOT EXISTS (
                            SELECT 1 FROM wallet_balances wb
                            WHERE wb.organization_id = o.id
                            AND wb.wallet_credit_id IS NULL
                        )
                        """
                    )
                )
            ).fetchall()
            if rows:
                await session.execute(
                    text(
                        """
                        INSERT INTO wallet_balances
                            (id, organization_id, wallet_credit_id, balance_musd, floor_musd)
                        VALUES (:id, :organization_id, NULL, 0, 0)
                        ON CONFLICT (organization_id) WHERE wallet_credit_id IS NULL
                        DO NOTHING
                        """
                    ),
                    [
                        {"id": uuid_utils.uuid7(), "organization_id": row.id}
                        for row in rows
                    ],
                )

        async with engine.session() as session:
            assert (
                await _general_balance_row_count(
                    session, organization_id=organization_id
                )
                == 1
            )
    finally:
        async with engine.session() as session:
            await _cleanup(
                session, organization_ids=organization_ids, user_ids=user_ids
            )
        command.downgrade(alembic_cfg, DOWN_REVISION)


async def test_backfill_does_not_touch_an_already_provisioned_organization():
    """An organization whose general row was already created (e.g. by
    `WalletsService.provision_general_balance` on a live cutover racing this migration)
    keeps its existing row untouched — the backfill only fills the gap."""
    command.upgrade(alembic_cfg, DOWN_REVISION)
    engine = get_transactions_engine()
    organization_ids, user_ids = [], []

    try:
        async with engine.session() as session:
            organization_id, user_id = await _insert_organization(session)
            organization_ids.append(organization_id)
            user_ids.append(user_id)

            # Simulate a row already provisioned with real, non-zero state.
            await session.execute(
                text(
                    "INSERT INTO wallet_balances "
                    "(id, organization_id, wallet_credit_id, balance_musd, floor_musd) "
                    "VALUES (:id, :organization_id, NULL, :balance, :floor)"
                ),
                {
                    "id": uuid.uuid4(),
                    "organization_id": organization_id,
                    "balance": 12_345,
                    "floor": -999,
                },
            )

        command.upgrade(alembic_cfg, BACKFILL_REVISION)

        async with engine.session() as session:
            assert (
                await _general_balance_row_count(
                    session, organization_id=organization_id
                )
                == 1
            )

            result = await session.execute(
                text(
                    "SELECT balance_musd, floor_musd FROM wallet_balances "
                    "WHERE organization_id = :organization_id AND wallet_credit_id IS NULL"
                ),
                {"organization_id": organization_id},
            )
            balance_musd, floor_musd = result.one()
            # Untouched — the pre-existing real state, not the backfill's zero defaults.
            assert balance_musd == 12_345
            assert floor_musd == -999
    finally:
        async with engine.session() as session:
            await _cleanup(
                session, organization_ids=organization_ids, user_ids=user_ids
            )
        command.downgrade(alembic_cfg, DOWN_REVISION)
