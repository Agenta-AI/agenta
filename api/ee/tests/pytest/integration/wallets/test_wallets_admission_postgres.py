"""Real-Postgres coverage for the admission read, `WalletsService.check`.

- Expired credit value is not spendable (open-designs item 21). The general row keeps
  counting an expired credit's remainder, because nothing posts it out; admission must
  subtract it, on the same clock settlement uses to skip the credit.
- `check` provisions a missing general row (open-designs item 14) against the real
  partial unique index, not only against the in-memory fake.
- The award replay key is unique in the database, not only under the general-row lock.

Self-skips via `conftest.py` when `env.postgres.uri_core` is unreachable.
"""

import asyncio
import uuid
from datetime import datetime, timedelta, timezone

import pytest
from alembic import command
from sqlalchemy import text
from sqlalchemy.exc import IntegrityError

import oss.src.dbs.postgres.shared.engine as engine_module
from ee.databases.postgres.migrations.core_ee.utils import alembic_cfg
from ee.src.core.wallets.plans import LAZY_PROVISION_FLOOR_MUSD
from ee.src.core.wallets.service import WalletsService
from ee.src.dbs.postgres.wallets.dao import WalletsDAO
from ee.tests.pytest.utils.wallets.builders import build_debit_command
from oss.src.dbs.postgres.shared.engine import get_transactions_engine

pytestmark = [
    pytest.mark.asyncio,
    pytest.mark.integration,
    pytest.mark.xdist_group(name="wallets-integration"),
]

DOWN_REVISION = "ee0000000003"
SCHEMA_REVISION = "ee0000000004"

TWENTY_DOLLARS = 20_000_000
FIVE_DOLLARS = 5_000_000
SEVEN_DOLLARS = 7_000_000


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
        for table in ("wallet_debits", "wallet_balances", "wallet_credits"):
            await session.execute(
                text(f"DELETE FROM {table} WHERE organization_id = :organization_id"),
                {"organization_id": organization_id},
            )


async def _award(dao, *, organization_id, key, amount_musd, end_time):
    return await dao.award_credit(
        organization_id=organization_id,
        idempotency_key=key,
        credit_kind="purchase",
        amount_musd=amount_musd,
        priority=10,
        end_time=end_time,
        now=datetime.now(timezone.utc) - timedelta(days=30),
    )


async def test_check_does_not_count_expired_credit_value(wallet_schema):
    """The worked failure from item 21: twenty dollars that expired yesterday and
    nothing else. The raw general row reads twenty dollars; admission must refuse."""
    organization_id = uuid.uuid4()
    dao = WalletsDAO()
    service = WalletsService(wallets_dao=dao)
    now = datetime.now(timezone.utc)

    try:
        await _award(
            dao,
            organization_id=organization_id,
            key="expired",
            amount_musd=TWENTY_DOLLARS,
            end_time=now - timedelta(days=1),
        )

        general = await dao.get_general_balance(organization_id=organization_id)
        assert general.balance_musd == TWENTY_DOLLARS
        spendable = await dao.get_spendable_balance(organization_id=organization_id)
        assert spendable.spendable_musd == 0
        assert await service.check(organization_id=organization_id) is False

        await _award(
            dao,
            organization_id=organization_id,
            key="live",
            amount_musd=FIVE_DOLLARS,
            end_time=now + timedelta(days=1),
        )

        spendable = await dao.get_spendable_balance(organization_id=organization_id)
        assert spendable.spendable_musd == FIVE_DOLLARS
        assert await service.check(organization_id=organization_id) is True

        # Settlement skips the expired credit, so a seven-dollar charge drains the live
        # five and books two as deficit. Admission and settlement agree on the result.
        await dao.settle(
            command=build_debit_command(
                organization_id=organization_id,
                idempotency_key="after_expiry",
                amount_musd=SEVEN_DOLLARS,
                created_at=now,
            )
        )

        general = await dao.get_general_balance(organization_id=organization_id)
        assert general.balance_musd == TWENTY_DOLLARS + FIVE_DOLLARS - SEVEN_DOLLARS
        spendable = await dao.get_spendable_balance(organization_id=organization_id)
        assert spendable.spendable_musd == FIVE_DOLLARS - SEVEN_DOLLARS
        assert await service.check(organization_id=organization_id) is False
    finally:
        await _cleanup(organization_id)


async def test_check_provisions_a_missing_general_balance(wallet_schema):
    organization_id = uuid.uuid4()
    dao = WalletsDAO()
    service = WalletsService(wallets_dao=dao)

    try:
        assert await dao.get_general_balance(organization_id=organization_id) is None

        results = await asyncio.gather(
            *(service.check(organization_id=organization_id) for _ in range(4))
        )

        assert results == [False] * 4
        general = await dao.get_general_balance(organization_id=organization_id)
        assert general.balance_musd == 0
        assert general.floor_musd == LAZY_PROVISION_FLOOR_MUSD

        engine = get_transactions_engine()
        async with engine.session() as session:
            count = (
                await session.execute(
                    text(
                        "SELECT count(*) FROM wallet_balances WHERE organization_id ="
                        " :organization_id AND wallet_credit_id IS NULL"
                    ),
                    {"organization_id": organization_id},
                )
            ).scalar()
        assert count == 1
    finally:
        await _cleanup(organization_id)


async def test_a_second_credit_for_one_award_key_is_rejected(wallet_schema):
    organization_id = uuid.uuid4()
    dao = WalletsDAO()
    engine = get_transactions_engine()
    insert = text(
        "INSERT INTO wallet_credits"
        " (id, organization_id, credit_kind, amount_musd, priority, data)"
        " VALUES (:id, :organization_id, 'signup_grant', 1, 20,"
        " CAST(:data AS jsonb))"
    )
    data = '{"references": {"award_idempotency_key": "award:signup:x"}}'

    try:
        await _award(
            dao,
            organization_id=organization_id,
            key="award:signup:x",
            amount_musd=1,
            end_time=None,
        )

        with pytest.raises(IntegrityError, match="uq_wallet_credits_org_award_key"):
            async with engine.session() as session:
                await session.execute(
                    insert,
                    {
                        "id": uuid.uuid4(),
                        "organization_id": organization_id,
                        "data": data,
                    },
                )
    finally:
        await _cleanup(organization_id)


async def test_settlement_judges_expiry_on_the_database_clock(
    wallet_schema, monkeypatch
):
    """Admission judges expiry on the database clock. Settlement must too: an API host
    whose clock runs ahead must not treat a credit the database still sees as live as
    expired, and book the charge as deficit."""
    import ee.src.core.wallets.types as types_module

    real_datetime = types_module.datetime

    class _ClockAhead(real_datetime):
        @classmethod
        def now(cls, tz=None):
            return real_datetime.now(tz) + timedelta(hours=2)

    organization_id = uuid.uuid4()
    dao = WalletsDAO()
    now = datetime.now(timezone.utc)

    try:
        credit = await _award(
            dao,
            organization_id=organization_id,
            key="live_for_an_hour",
            amount_musd=FIVE_DOLLARS,
            end_time=now + timedelta(hours=1),
        )
        assert await WalletsService(wallets_dao=dao).check(
            organization_id=organization_id
        )

        monkeypatch.setattr(types_module, "datetime", _ClockAhead)
        debits = await dao.settle(
            command=build_debit_command(
                organization_id=organization_id,
                idempotency_key="app_clock_ahead",
                amount_musd=1_000,
                created_at=now,
            )
        )

        assert [debit.wallet_credit_id for debit in debits] == [credit.id]
    finally:
        await _cleanup(organization_id)
