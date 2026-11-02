"""Sandbox seconds through the whole wallet chain, on real Postgres and Redis.

A reported interval enters the real `SandboxUsageService`, is published by the real Redis
publisher onto `streams:measurements`, persisted and priced by `MeasurementWorker`, and
settled by `DebitWorker`; admission reads the real `WalletsService`.
"""

import asyncio
from datetime import datetime, timedelta, timezone
from uuid import uuid4

import pytest
from alembic import command
from redis.asyncio import Redis
from sqlalchemy import update

import oss.src.dbs.postgres.shared.engine as engine_module
from oss.src.dbs.postgres.shared.engine import AnalyticsEngine, get_transactions_engine
from oss.src.utils.context import AuthScope
from oss.src.utils.env import env

from ee.databases.postgres.migrations.core_ee.utils import alembic_cfg

from ee.src.core.measurements.sandboxes import (
    SandboxUsageInterval,
    SandboxUsageService,
)
from ee.src.dbs.postgres.measurements.usage import MeasurementUsageDAO
from ee.src.dbs.postgres.wallets.dao import WalletsDAO
from ee.src.dbs.postgres.wallets.dbes import WalletBalanceDBE
from ee.src.dbs.postgres.wallets.usage import WalletUsageDAO
from ee.src.core.wallets.usage.service import WalletUsageService
from ee.src.dbs.redis.wallets.streams import RedisMeasurementPublisher
from ee.src.dbs.redis.wallets.turns import RedisSessionTurnHolds, RedisTurnSlots
from ee.tests.pytest.utils.measurements.fakes import no_plan
from ee.tests.pytest.integration.wallets.test_wallets_gateway_chain_postgres import (
    DOWN_REVISION,
    SCHEMA_REVISION,
    _Chain,
    _cleanup,
    _debits,
    _fund,
    _general_balance,
    _measurement_values,
)

pytestmark = [
    pytest.mark.asyncio,
    pytest.mark.integration,
    pytest.mark.xdist_group(name="wallets-integration"),
]


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


@pytest.fixture
async def redis_client():
    client = Redis.from_url(env.redis.uri_durable, decode_responses=False)
    yield client
    await client.aclose()


@pytest.fixture
async def analytics_engine():
    engine = AnalyticsEngine()
    yield engine
    await engine.close()


START = datetime.now(timezone.utc).replace(microsecond=0) - timedelta(minutes=10)


def _scope(organization_id) -> AuthScope:
    return AuthScope(
        organization_id=organization_id,
        workspace_id=uuid4(),
        project_id=uuid4(),
        user_id=uuid4(),
    )


def _interval(sandbox_id, offset_seconds=0, seconds=60) -> SandboxUsageInterval:
    start = START + timedelta(seconds=offset_seconds)
    return SandboxUsageInterval(
        provider="daytona",
        sandbox_id=sandbox_id,
        start_time=start,
        end_time=start + timedelta(seconds=seconds),
        vcpu=2,
        memory_gib=4,
        session_id="session-sbx",
    )


def _service(client, chain) -> SandboxUsageService:
    return SandboxUsageService(
        wallet=chain.wallets,
        publisher=RedisMeasurementPublisher(redis_client=client),
        turn_slots=RedisTurnSlots(redis_client=client),
        session_holds=RedisSessionTurnHolds(redis_client=client),
        plan_for=no_plan,
    )


async def test_each_running_interval_is_charged_once_at_its_resource_price(
    wallet_schema, redis_client, analytics_engine
):
    organization_id = uuid4()
    await _fund(organization_id)
    chain = _Chain(redis_client=redis_client, analytics_engine=analytics_engine)
    await chain.start_workers()
    service = _service(redis_client, chain)
    scope = _scope(organization_id)
    before = await _general_balance(organization_id)
    sandbox_id = f"sb-{uuid4().hex}"

    first = await service.record(scope=scope, interval=_interval(sandbox_id))
    # The runner timed out on the first report and sent it again.
    assert await service.record(scope=scope, interval=_interval(sandbox_id)) == first
    # The final partial interval at teardown.
    await service.record(
        scope=scope, interval=_interval(sandbox_id, offset_seconds=60, seconds=17)
    )
    await chain.run_workers()

    row, values = await _measurement_values(analytics_engine, first)
    assert row.resource_key == "sbx:daytona" and row.endpoint_kind == "builtin"
    assert values == {
        "sandbox_seconds": 60,
        "vcpu_seconds": 120,
        "memory_gib_seconds": 240,
    }
    # 60 s: 8280 musd. 17 s: (34 x 151_200 + 68 x 48_600) / 3600 = 2346 musd.
    debits = await _debits(organization_id)
    assert sorted(d.amount_musd for d in debits) == [2346, 8280]
    assert {d.idempotency_key for d in debits} >= {f"measurement:{first}"}
    assert await _general_balance(organization_id) == before - 8280 - 2346

    usage = await WalletUsageService(
        wallets_dao=WalletsDAO(engine=get_transactions_engine()),
        usage_dao=WalletUsageDAO(engine=get_transactions_engine()),
        measurements_dao=MeasurementUsageDAO(engine=analytics_engine),
    ).usage(organization_id=organization_id)
    [session] = usage.sessions
    assert session.session_id == "session-sbx"
    assert sorted(
        (c.category, c.sandbox_seconds, c.vcpu, c.memory_gib, c.amount_musd)
        for c in session.charges
    ) == [("Runtime", 17, 2, 4, 2346), ("Runtime", 60, 2, 4, 8280)]

    await _cleanup(organization_id)


async def test_a_turn_is_admitted_until_the_balance_reaches_its_floor(
    wallet_schema, redis_client, analytics_engine
):
    organization_id = uuid4()
    await _fund(organization_id)
    chain = _Chain(redis_client=redis_client, analytics_engine=analytics_engine)
    service = _service(redis_client, chain)
    scope = _scope(organization_id)

    assert (await service.admit(scope=scope)).allowed is True

    async with get_transactions_engine().session() as session:
        await session.execute(
            update(WalletBalanceDBE)
            .where(WalletBalanceDBE.organization_id == organization_id)
            .values(balance_musd=0)
        )
        await session.commit()

    assert (await service.admit(scope=scope)).allowed is False

    await _cleanup(organization_id)


async def test_a_hobby_organization_runs_two_turns_at_once_against_real_redis(
    wallet_schema, redis_client, analytics_engine
):
    organization_id = uuid4()
    await _fund(organization_id)
    chain = _Chain(redis_client=redis_client, analytics_engine=analytics_engine)

    async def hobby(_):
        return "cloud_v0_hobby"

    service = SandboxUsageService(
        wallet=chain.wallets,
        publisher=RedisMeasurementPublisher(redis_client=redis_client),
        turn_slots=RedisTurnSlots(redis_client=redis_client),
        session_holds=RedisSessionTurnHolds(redis_client=redis_client),
        plan_for=hobby,
    )
    scope = _scope(organization_id)

    first = await service.admit(scope=scope, turn_id="turn-1")
    second = await service.admit(scope=scope, turn_id="turn-2")
    third = await service.admit(scope=scope, turn_id="turn-3")

    assert first.allowed and first.slot_held and first.turn_limit.seconds == 1800
    assert second.allowed and second.slot_held
    assert not third.allowed and third.code == "concurrent_turns_limit"

    await service.release_turn(scope=scope, turn_id="turn-1")
    assert (await service.admit(scope=scope, turn_id="turn-3")).allowed

    for turn in ("turn-2", "turn-3"):
        await service.release_turn(scope=scope, turn_id=turn)
    await _cleanup(organization_id)
