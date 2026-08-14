"""Real-Postgres coverage for the B2/B3 grant-award flow from WP-1-05:
`WalletsDAO.award_credit`'s replay guard (keyed on `data.references.award_idempotency_key`,
same JSONB-lookup shape as `apply_plan_change`'s `plan_change_idempotency_key`), and the
`_award_signup_grant`/`_provision_wallet_general_balance` organizations-service hooks that
wire the signup path (`provision_signup_subscription`) end to end against the real DAO.

Unit tests in `ee/tests/pytest/unit/wallets/test_wallets_grants.py` cover the same
behavior against the in-memory `FakeWalletsDAO`; this file proves the real DAO's
`data->references->award_idempotency_key` JSONB lookup and locking/replay-guard logic
actually hold against Postgres — a compiled-SQL-only unit test cannot prove either.

`wallet_balances`/`wallet_credits`/`wallet_debits` carry no FK to the shared
`organizations` table (see `ee.src.dbs.postgres.wallets.dbes`), so — like the sibling
`test_wallets_provisioning_postgres.py` — these tests use bare random UUIDs rather than
creating real organization/user rows; the organizations-service hooks under test
(`_provision_wallet_general_balance`, `_award_signup_grant`) take only an
`organization_id` and never touch the `organizations` table themselves.

Self-skips via `conftest.py` when `env.postgres.uri_core` is unreachable. WRITTEN BUT NOT
RUN — see `docs/design/wallets-research/v1/nodes/im-1-02-pipeline/acceptance.md`.
"""

import uuid
from datetime import datetime, timedelta, timezone

import pytest
from alembic import command
from sqlalchemy import text

import ee.src.core.organizations.service as organizations_service_module
import oss.src.dbs.postgres.shared.engine as engine_module
from ee.databases.postgres.migrations.core_ee.utils import alembic_cfg
from ee.src.core.wallets.grants import compose_award_idempotency_key
from ee.src.dbs.postgres.wallets.dao import WalletsDAO
from oss.src.dbs.postgres.shared.engine import get_transactions_engine

pytestmark = [pytest.mark.asyncio, pytest.mark.integration]

DOWN_REVISION = "ee0000000003"
# Schema only (wallet tables) — the ee0000000005 backfill migration is not needed for
# these DAO-level tests, same reasoning as test_wallets_provisioning_postgres.py.
SCHEMA_REVISION = "ee0000000004"


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


async def test_award_credit_is_idempotent_against_real_conflict(wallet_schema):
    organization_id = uuid.uuid4()
    dao = WalletsDAO()

    try:
        await dao.provision_general_balance(organization_id=organization_id)

        idempotency_key = compose_award_idempotency_key(
            activity_code="signup", organization_id=organization_id
        )
        now = datetime(2026, 8, 14, tzinfo=timezone.utc)
        end_time = now + timedelta(days=365)

        first = await dao.award_credit(
            organization_id=organization_id,
            idempotency_key=idempotency_key,
            credit_kind="award",
            amount_musd=1_000_000,
            priority=20,
            end_time=end_time,
            now=now,
        )

        assert first.amount_musd == 1_000_000
        assert first.credit_kind == "award"
        assert first.end_time == end_time

        general = await dao.get_general_balance(organization_id=organization_id)
        assert general.balance_musd == 1_000_000

        # Second delivery of the SAME idempotency_key — even with different amounts —
        # must return the ORIGINAL credit and write nothing new.
        second = await dao.award_credit(
            organization_id=organization_id,
            idempotency_key=idempotency_key,
            credit_kind="award",
            amount_musd=999_999,
            priority=99,
            end_time=now,
            now=now,
        )

        assert second.id == first.id
        assert second.amount_musd == 1_000_000  # unchanged, the original row

        general_after_replay = await dao.get_general_balance(
            organization_id=organization_id
        )
        assert general_after_replay.balance_musd == 1_000_000  # not double-applied

        engine = get_transactions_engine()
        async with engine.session() as session:
            result = await session.execute(
                text(
                    "SELECT count(*) FROM wallet_credits "
                    "WHERE organization_id = :organization_id"
                ),
                {"organization_id": organization_id},
            )
            assert result.scalar() == 1  # only ONE credit was ever minted
    finally:
        await _cleanup(organization_id)


async def test_award_signup_grant_via_organizations_service_hooks_against_real_db(
    wallet_schema, monkeypatch
):
    """Exercises the real hooks the signup path (`provision_signup_subscription`) calls:
    `_provision_wallet_general_balance` then `_award_signup_grant`, in that order, against
    the real DAO/singleton wallets service. Proves the end-to-end wiring, not just the DAO
    method in isolation."""
    organization_id = uuid.uuid4()

    # Force the process-wide wallets-service singleton onto a fresh WalletsDAO bound to
    # THIS test's engine, mirroring the `_fresh_engine_per_test` reset above.
    import ee.src.core.wallets.runtime as wallets_runtime_module

    monkeypatch.setattr(wallets_runtime_module, "_wallet_settlement_port", None)

    try:
        await organizations_service_module._provision_wallet_general_balance(
            organization_id=organization_id, plan="cloud_v0_hobby"
        )
        await organizations_service_module._award_signup_grant(
            organization_id=organization_id
        )

        dao = WalletsDAO()
        general = await dao.get_general_balance(organization_id=organization_id)
        assert general is not None
        assert general.balance_musd == 1_000_000  # the $1 signup grant landed

        # A second signup-path run (retry, duplicate call) must not double-award.
        await organizations_service_module._award_signup_grant(
            organization_id=organization_id
        )
        general_after_retry = await dao.get_general_balance(
            organization_id=organization_id
        )
        assert general_after_retry.balance_musd == 1_000_000

        engine = get_transactions_engine()
        async with engine.session() as session:
            result = await session.execute(
                text(
                    "SELECT count(*) FROM wallet_credits "
                    "WHERE organization_id = :organization_id AND credit_kind = 'award'"
                ),
                {"organization_id": organization_id},
            )
            assert result.scalar() == 1
    finally:
        await _cleanup(organization_id)
        monkeypatch.setattr(wallets_runtime_module, "_wallet_settlement_port", None)
