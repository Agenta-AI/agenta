"""Real-Postgres coverage for `entrypoints.backfill_wallet_signup_grants`, the one-off job
that awards the signup grant to organizations created while `AGENTA_WALLETS_ENABLED` was
off (open-designs item 15).

Inserts real `users`/`organizations` rows inside a far-past `created_at` window that the
job is scoped to, so no other organization in the database is touched, and deletes them
and their wallet rows in `finally` before the schema fixture downgrades.

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
from ee.src.core.wallets.grants import SIGNUP_GRANT_AMOUNT_MUSD
from ee.src.core.wallets.service import WalletsService
from ee.src.dbs.postgres.wallets.dao import WalletsDAO
from entrypoints.backfill_wallet_signup_grants import backfill_signup_grants
from oss.src.dbs.postgres.shared.engine import get_transactions_engine

pytestmark = [
    pytest.mark.asyncio,
    pytest.mark.integration,
    pytest.mark.xdist_group(name="wallets-integration"),
]

DOWN_REVISION = "ee0000000003"
SCHEMA_REVISION = "ee0000000004"

WINDOW_FROM = datetime(2001, 1, 1, tzinfo=timezone.utc)
WINDOW_TO = datetime(2001, 2, 1, tzinfo=timezone.utc)


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


class _Fixtures:
    def __init__(self):
        self.user_ids = []
        self.organization_ids = []

    async def user(self, session) -> uuid.UUID:
        user_id = uuid.uuid4()
        unique = uuid.uuid4().hex
        await session.execute(
            text(
                "INSERT INTO users (id, uid, username, email)"
                " VALUES (:id, :uid, :username, :email)"
            ),
            {
                "id": user_id,
                "uid": unique,
                "username": f"wallet-grant-backfill-{unique}",
                "email": f"wallet-grant-backfill-{unique}@example.invalid",
            },
        )
        self.user_ids.append(user_id)
        return user_id

    async def organization(
        self, session, *, owner_id, created_at, deleted=False
    ) -> uuid.UUID:
        organization_id = uuid.uuid4()
        await session.execute(
            text(
                "INSERT INTO organizations (id, name, owner_id, created_at, deleted_at)"
                " VALUES (:id, :name, :owner_id, :created_at, :deleted_at)"
            ),
            {
                "id": organization_id,
                "name": "wallet-grant-backfill",
                "owner_id": owner_id,
                "created_at": created_at,
                "deleted_at": created_at if deleted else None,
            },
        )
        self.organization_ids.append(organization_id)
        return organization_id

    async def cleanup(self):
        engine = get_transactions_engine()
        async with engine.session() as session:
            for organization_id in self.organization_ids:
                for table in ("wallet_debits", "wallet_balances", "wallet_credits"):
                    await session.execute(
                        text(f"DELETE FROM {table} WHERE organization_id = :id"),
                        {"id": organization_id},
                    )
                await session.execute(
                    text("DELETE FROM organizations WHERE id = :id"),
                    {"id": organization_id},
                )
            for user_id in self.user_ids:
                await session.execute(
                    text("DELETE FROM users WHERE id = :id"), {"id": user_id}
                )


async def _signup_grants(organization_id) -> list:
    engine = get_transactions_engine()
    async with engine.session() as session:
        return (
            await session.execute(
                text(
                    "SELECT amount_musd FROM wallet_credits"
                    " WHERE organization_id = :id AND credit_kind = 'signup_grant'"
                ),
                {"id": organization_id},
            )
        ).all()


async def test_backfill_awards_one_grant_per_signup_organization(wallet_schema):
    fixtures = _Fixtures()
    engine = get_transactions_engine()
    day = timedelta(days=1)

    try:
        async with engine.session() as session:
            owner_a = await fixtures.user(session)
            signup_a = await fixtures.organization(
                session, owner_id=owner_a, created_at=WINDOW_FROM + day
            )
            # A later organization of the same owner came from POST /organizations/,
            # which never earns the signup grant.
            extra_a = await fixtures.organization(
                session, owner_id=owner_a, created_at=WINDOW_FROM + 2 * day
            )
            owner_b = await fixtures.user(session)
            signup_b = await fixtures.organization(
                session, owner_id=owner_b, created_at=WINDOW_FROM + 3 * day
            )
            owner_c = await fixtures.user(session)
            already_granted = await fixtures.organization(
                session, owner_id=owner_c, created_at=WINDOW_FROM + 4 * day
            )
            owner_d = await fixtures.user(session)
            deleted = await fixtures.organization(
                session,
                owner_id=owner_d,
                created_at=WINDOW_FROM + 5 * day,
                deleted=True,
            )
            owner_e = await fixtures.user(session)
            outside_window = await fixtures.organization(
                session, owner_id=owner_e, created_at=WINDOW_TO + day
            )
            # An undated organization leaves the owner with no provable earliest
            # organization, so neither of its organizations is granted.
            owner_f = await fixtures.user(session)
            dated_f = await fixtures.organization(
                session, owner_id=owner_f, created_at=WINDOW_FROM + 6 * day
            )
            undated_f = await fixtures.organization(
                session, owner_id=owner_f, created_at=None
            )

        await WalletsService(wallets_dao=WalletsDAO()).award(
            organization_id=already_granted, activity_code="signup"
        )

        window = dict(created_from=WINDOW_FROM, created_to=WINDOW_TO, batch_size=1)

        dry_run = await backfill_signup_grants(apply=False, **window)
        assert (dry_run.eligible, dry_run.awarded, dry_run.failed) == (2, 0, 0)
        assert await _signup_grants(signup_a) == []

        first = await backfill_signup_grants(apply=True, **window)
        assert (first.eligible, first.awarded, first.failed) == (2, 2, 0)

        second = await backfill_signup_grants(apply=True, **window)
        assert (second.eligible, second.awarded, second.failed) == (0, 0, 0)

        for organization_id in (signup_a, signup_b, already_granted):
            grants = await _signup_grants(organization_id)
            assert [row.amount_musd for row in grants] == [SIGNUP_GRANT_AMOUNT_MUSD]
        for organization_id in (extra_a, deleted, outside_window, dated_f, undated_f):
            assert await _signup_grants(organization_id) == []

        general = await WalletsDAO().get_general_balance(organization_id=signup_a)
        assert general.balance_musd == SIGNUP_GRANT_AMOUNT_MUSD
    finally:
        await fixtures.cleanup()
