"""Real-Postgres coverage for the wallet's credit sources: the daily free credits under
concurrent admissions, the monthly and purchased credits under redelivery, and the
`entrypoints.migrate_starter_credits_to_wallet` job against a fake proxy client.

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
from ee.src.core.starter_credits_bridge.service import PROXY_ORIGIN
from ee.src.core.wallets.grants import DAILY_FREE_CREDITS_MUSD, next_utc_midnight
from ee.src.core.wallets.service import WalletsService
from ee.src.dbs.postgres.wallets.dao import WalletsDAO
from entrypoints.migrate_starter_credits_to_wallet import migrate_starter_credits
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


# ---------------------------------------------------------------------------
# Starter-credits migration job
# ---------------------------------------------------------------------------


class FakeProxyClient:
    """The proxy's key list and key info, with blocking. A block freezes the key's
    spend; `spend_before_block` is spend that lands between the list and the block."""

    def __init__(self, keys, *, spend_before_block=None):
        self.keys = {key["token"]: dict(key) for key in keys}
        self.spend_before_block = dict(spend_before_block or {})
        self.blocked_calls = []

    async def list_team_keys(self, *, team_id, page, size):
        assert team_id == "team-1"
        tokens = sorted(self.keys)
        return [
            dict(self.keys[token]) for token in tokens[(page - 1) * size : page * size]
        ]

    async def block_key(self, *, key):
        self.blocked_calls.append(key)
        record = self.keys[key]
        if not record.get("blocked"):
            record["spend"] += self.spend_before_block.pop(key, 0)
        record["blocked"] = True

    async def get_key_info(self, *, key):
        return dict(self.keys[key])


async def _organization(session, *, deleted=False):
    unique = uuid.uuid4().hex
    user_id = uuid.uuid4()
    organization_id = uuid.uuid4()
    await session.execute(
        text(
            "INSERT INTO users (id, uid, username, email)"
            " VALUES (:id, :uid, :username, :email)"
        ),
        {
            "id": user_id,
            "uid": unique,
            "username": f"starter-migration-{unique}",
            "email": f"starter-migration-{unique}@example.invalid",
        },
    )
    await session.execute(
        text(
            "INSERT INTO organizations (id, name, owner_id, created_at, deleted_at)"
            " VALUES (:id, 'starter-migration', :owner_id, now(),"
            " CASE WHEN :deleted THEN now() END)"
        ),
        {"id": organization_id, "owner_id": user_id, "deleted": deleted},
    )
    return user_id, organization_id


def _key(token, organization_id, *, spend, max_budget=5.0, origin=PROXY_ORIGIN):
    return {
        "token": token,
        "key_alias": str(organization_id),
        "spend": spend,
        "max_budget": max_budget,
        "blocked": False,
        "metadata": {"organization_id": str(organization_id), "origin": origin},
    }


async def test_migration_moves_each_remainder_once_and_blocks_every_key(
    wallet_schema,
):
    engine = get_transactions_engine()
    async with engine.session() as session:
        rows = [await _organization(session) for _ in range(3)]
        rows.append(await _organization(session, deleted=True))
    (_, partly_spent), (_, fully_spent), (_, foreign), (_, deleted) = rows
    organization_ids = [organization_id for _, organization_id in rows]

    client = FakeProxyClient(
        [
            _key("a-partly", partly_spent, spend=1.25),
            _key("b-fully", fully_spent, spend=5.3),
            _key("c-foreign", foreign, spend=0.0, origin="someone-else"),
            _key("d-deleted", deleted, spend=0.0),
        ],
        # Spend that lands before the block is not granted.
        spend_before_block={"a-partly": 0.5},
    )

    try:
        dry_run = await migrate_starter_credits(
            apply=False, client=client, team_id="team-1", page_size=2
        )
        assert (dry_run.keys, dry_run.no_organization, dry_run.granted) == (3, 1, 0)
        assert dry_run.remaining_musd == 3_750_000
        assert client.blocked_calls == []
        assert await _credits(partly_spent, "starter_credits") == []

        first = await migrate_starter_credits(
            apply=True, client=client, team_id="team-1", page_size=2
        )
        assert (first.granted, first.granted_musd, first.blocked) == (1, 3_250_000, 3)
        assert (first.zero_remaining, first.no_organization, first.failed) == (1, 1, 0)

        [credit] = await _credits(partly_spent, "starter_credits")
        assert credit.amount_musd == 3_250_000
        assert credit.end_time - credit.start_time == timedelta(days=365)
        assert await _credits(fully_spent, "starter_credits") == []
        assert await _credits(deleted, "starter_credits") == []
        assert not client.keys["c-foreign"]["blocked"]
        assert client.keys["d-deleted"]["blocked"]

        rerun = await migrate_starter_credits(
            apply=True, client=client, team_id="team-1", page_size=2
        )
        assert (rerun.blocked, rerun.failed) == (0, 0)
        assert [
            row.amount_musd for row in await _credits(partly_spent, "starter_credits")
        ] == [3_250_000]
        assert await _general_balance(partly_spent) == 3_250_000
    finally:
        await _cleanup(*organization_ids)
        async with engine.session() as session:
            for user_id, organization_id in rows:
                await session.execute(
                    text("DELETE FROM organizations WHERE id = :id"),
                    {"id": organization_id},
                )
                await session.execute(
                    text("DELETE FROM users WHERE id = :id"), {"id": user_id}
                )
