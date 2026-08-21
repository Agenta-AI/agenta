"""Redis + core Postgres integration: full consume-settle-ACK through `DebitWorker`,
producing the same debit command twice and proving exactly one financial effect.

Requires a reachable core Postgres (`AGENTA_POSTGRES_URI_CORE` or equivalent) and durable
Redis; `conftest.py` skips this module otherwise.
"""

from uuid import uuid4

import pytest
from alembic import command
from redis.asyncio import Redis
from sqlalchemy import select

import oss.src.dbs.postgres.shared.engine as engine_module
from oss.src.dbs.postgres.shared.engine import get_transactions_engine
from oss.src.utils.env import env

from ee.databases.postgres.migrations.core_ee.utils import alembic_cfg
from ee.src.core.wallets.contracts import STREAM_DEBITS
from ee.src.core.wallets.service import WalletsService
from ee.src.core.wallets.streaming import RedisDebitPublisher
from ee.src.dbs.postgres.wallets.dao import WalletsDAO
from ee.src.dbs.postgres.wallets.dbes import WalletBalanceDBE, WalletDebitDBE
from ee.src.tasks.asyncio.wallets.worker import DebitWorker
from ee.tests.pytest.utils.wallets.builders import build_debit_command

pytestmark = [pytest.mark.asyncio, pytest.mark.integration]

DOWN_REVISION = "ee0000000003"
REVISION = "ee0000000004"

STARTING_GENERAL_BALANCE = 0
STARTING_FLOOR = -1_000_000


@pytest.fixture(autouse=True)
async def _fresh_engine_per_test():
    engine_module._transactions_engine = None
    yield
    if engine_module._transactions_engine is not None:
        await engine_module._transactions_engine.close()
        engine_module._transactions_engine = None


@pytest.fixture
async def wallet_schema():
    command.upgrade(alembic_cfg, REVISION)
    try:
        yield
    finally:
        command.downgrade(alembic_cfg, DOWN_REVISION)


@pytest.fixture
async def redis_client():
    client = Redis.from_url(env.redis.uri_durable, decode_responses=False)
    yield client
    await client.close()


async def _seed_general_balance(*, organization_id):
    engine = get_transactions_engine()
    async with engine.session() as session:
        session.add(
            WalletBalanceDBE(
                id=uuid4(),
                organization_id=organization_id,
                wallet_credit_id=None,
                balance_musd=STARTING_GENERAL_BALANCE,
                floor_musd=STARTING_FLOOR,
            )
        )
        await session.flush()


async def _make_group(redis_client: Redis, *, stream: str) -> str:
    """A fresh consumer group starting at `$` (tail-only) so this test only ever
    observes entries it publishes itself, regardless of pre-existing stream history."""
    group = f"worker-debits-test-{uuid4().hex}"
    await redis_client.xgroup_create(
        name=stream, groupname=group, id="$", mkstream=True
    )
    return group


async def _debit_rows(*, organization_id, idempotency_key):
    engine = get_transactions_engine()
    async with engine.session() as session:
        result = await session.execute(
            select(WalletDebitDBE).where(
                WalletDebitDBE.organization_id == organization_id,
                WalletDebitDBE.idempotency_key == idempotency_key,
            )
        )
        return result.scalars().all()


async def test_duplicate_debit_command_produces_one_financial_effect(
    wallet_schema, redis_client
):
    organization_id = uuid4()
    await _seed_general_balance(organization_id=organization_id)

    command_ = build_debit_command(
        organization_id=organization_id,
        idempotency_key=f"gw_integration_{uuid4().hex}",
        amount_musd=500,
    )

    group = await _make_group(redis_client, stream=STREAM_DEBITS)
    # A real WalletsService (the concrete WalletSettlementPort adapter, same class the
    # runtime factory wires) bound to this test's own engine — not the process-wide
    # singleton, so the fixture-scoped engine reset above stays authoritative.
    settlement_port = WalletsService(
        wallets_dao=WalletsDAO(engine=get_transactions_engine())
    )
    worker = DebitWorker(
        settlement_port=settlement_port,
        redis_client=redis_client,
        stream_name=STREAM_DEBITS,
        consumer_group=group,
    )

    publisher = RedisDebitPublisher()
    assert await publisher.publish(command_) is True
    assert await publisher.publish(command_) is True  # same command, produced twice

    batch = await worker.read_batch()
    assert len(batch) == 2

    count, processed_ids = await worker.process_batch(batch)
    assert count == 2  # both deliveries ACKed: the second is a settlement replay
    await worker.ack_and_delete(processed_ids)

    rows = await _debit_rows(
        organization_id=organization_id, idempotency_key=command_.idempotency_key
    )
    assert len(rows) == 1  # exactly one financial effect, not two
    assert rows[0].amount_musd == 500

    engine = get_transactions_engine()
    async with engine.session() as session:
        result = await session.execute(
            select(WalletBalanceDBE).where(
                WalletBalanceDBE.organization_id == organization_id,
                WalletBalanceDBE.wallet_credit_id.is_(None),
            )
        )
        balance = result.scalar_one()
        assert balance.balance_musd == STARTING_GENERAL_BALANCE - 500  # debited once
