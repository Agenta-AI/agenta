"""Redis + tracing Postgres integration: full consume-persist-publish through
`MeasurementWorker`, and a transient debit-publish failure converging to
exactly one measurement row and exactly one debit command.

Requires a reachable tracing Postgres (`AGENTA_POSTGRES_URI_TRACING` or
equivalent) and durable Redis; `conftest.py` skips this module otherwise.
"""

from uuid import uuid4

import pytest
from redis.asyncio import Redis
from sqlalchemy import select

from oss.src.dbs.postgres.shared.engine import AnalyticsEngine
from oss.src.utils.env import env

from ee.src.core.wallets.contracts import STREAM_DEBITS, STREAM_MEASUREMENTS
from ee.src.core.wallets.streaming import RedisDebitPublisher, RedisMeasurementPublisher
from ee.src.dbs.postgres.measurements.dao import MeasurementsDAO
from ee.src.dbs.postgres.measurements.dbes import MeasurementDBE, MeasurementValueDBE
from ee.src.tasks.asyncio.measurements.worker import MeasurementWorker
from ee.tests.pytest.utils.measurements.fakes import InMemoryOrganizationResolver
from ee.tests.pytest.utils.wallets.builders import build_measurement_command

pytestmark = [pytest.mark.asyncio, pytest.mark.integration]


class _OnceFailingDebitPublisher:
    """Wraps a real publisher; fails the first call, then delegates."""

    def __init__(self, inner):
        self.inner = inner
        self.calls = 0

    async def publish(self, command) -> bool:
        self.calls += 1
        if self.calls == 1:
            return False
        return await self.inner.publish(command)


@pytest.fixture
async def redis_client():
    client = Redis.from_url(env.redis.uri_durable, decode_responses=False)
    yield client
    await client.close()


@pytest.fixture
async def analytics_engine():
    engine = AnalyticsEngine()
    yield engine
    await engine.close()


async def _make_group(redis_client: Redis, *, stream: str) -> str:
    """A fresh consumer group starting at `$` (tail-only) so this test only
    ever observes entries it publishes itself, regardless of pre-existing
    stream history."""
    group = f"worker-measurements-test-{uuid4().hex}"
    await redis_client.xgroup_create(
        name=stream, groupname=group, id="$", mkstream=True
    )
    return group


async def _debits_since(redis_client: Redis, *, last_id: bytes) -> list:
    entries = await redis_client.xrange(STREAM_DEBITS, min=f"({last_id.decode()}")
    return entries


async def _fetch_measurement(analytics_engine: AnalyticsEngine, *, measurement_id: str):
    async with analytics_engine.session() as session:
        result = await session.execute(
            select(MeasurementDBE).where(
                MeasurementDBE.measurement_id == measurement_id
            )
        )
        return result.scalars().first()


async def _fetch_values(analytics_engine: AnalyticsEngine, *, measurement_row_id):
    async with analytics_engine.session() as session:
        result = await session.execute(
            select(MeasurementValueDBE).where(
                MeasurementValueDBE.measurement_id == measurement_row_id
            )
        )
        return result.scalars().all()


@pytest.mark.asyncio
async def test_full_consume_persist_publish(redis_client, analytics_engine):
    org_id = uuid4()
    command = build_measurement_command(
        organization_id=org_id,
        project_id=uuid4(),
        endpoint_kind="managed",
    )

    measurements_group = await _make_group(redis_client, stream=STREAM_MEASUREMENTS)
    last_debit_id = (await redis_client.xrevrange(STREAM_DEBITS, count=1)) or [
        (b"0-0", {})
    ]
    last_debit_id = last_debit_id[0][0]

    worker = MeasurementWorker(
        measurements_dao=MeasurementsDAO(engine=analytics_engine),
        organization_resolver=InMemoryOrganizationResolver(),
        debit_publisher=RedisDebitPublisher(),
        redis_client=redis_client,
        stream_name=STREAM_MEASUREMENTS,
        consumer_group=measurements_group,
    )

    published = await RedisMeasurementPublisher().publish(command)
    assert published is True

    batch = await worker.read_batch()
    assert len(batch) == 1

    count, processed_ids = await worker.process_batch(batch)
    assert count == 1
    await worker.ack_and_delete(processed_ids)

    row = await _fetch_measurement(
        analytics_engine, measurement_id=command.measurement_id
    )
    assert row is not None
    assert row.project_id == command.project_id

    values = await _fetch_values(analytics_engine, measurement_row_id=row.id)
    assert {v.key for v in values} == {c.key for c in command.components}

    new_debits = await _debits_since(redis_client, last_id=last_debit_id)
    assert len(new_debits) == 1


@pytest.mark.asyncio
async def test_transient_debit_publish_failure_converges_to_one_of_each(
    redis_client, analytics_engine
):
    org_id = uuid4()
    command = build_measurement_command(
        organization_id=org_id,
        project_id=uuid4(),
        endpoint_kind="managed",
    )

    measurements_group = await _make_group(redis_client, stream=STREAM_MEASUREMENTS)
    last_debit_id = (await redis_client.xrevrange(STREAM_DEBITS, count=1)) or [
        (b"0-0", {})
    ]
    last_debit_id = last_debit_id[0][0]

    failing_publisher = _OnceFailingDebitPublisher(RedisDebitPublisher())
    worker = MeasurementWorker(
        measurements_dao=MeasurementsDAO(engine=analytics_engine),
        organization_resolver=InMemoryOrganizationResolver(),
        debit_publisher=failing_publisher,
        redis_client=redis_client,
        stream_name=STREAM_MEASUREMENTS,
        consumer_group=measurements_group,
    )

    await RedisMeasurementPublisher().publish(command)

    # First attempt: tracing write succeeds, debit publish fails -> pending.
    batch = await worker.read_batch()
    count_1, processed_1 = await worker.process_batch(batch)
    assert count_1 == 0
    assert processed_1 == []

    row_after_first = await _fetch_measurement(
        analytics_engine, measurement_id=command.measurement_id
    )
    assert row_after_first is not None  # already persisted

    # Redelivery via XREADGROUP with the SAME id ("0" reclaims this
    # consumer's own pending entries) — no new XADD.
    pending = await redis_client.xreadgroup(
        groupname=measurements_group,
        consumername=worker.consumer_name,
        streams={STREAM_MEASUREMENTS: "0"},
        count=10,
    )
    redelivered_batch = pending[0][1] if pending else []
    assert len(redelivered_batch) == 1

    count_2, processed_2 = await worker.process_batch(redelivered_batch)
    assert count_2 == 1
    await worker.ack_and_delete(processed_2)

    row_after_second = await _fetch_measurement(
        analytics_engine, measurement_id=command.measurement_id
    )
    assert row_after_second is not None
    assert row_after_second.id == row_after_first.id  # same row — idempotent

    new_debits = await _debits_since(redis_client, last_id=last_debit_id)
    assert len(new_debits) == 1  # exactly one debit command, not zero, not two
