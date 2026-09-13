"""A wallet stream entry left pending must come back.

Both workers' `process_batch` promise that a retryable failure "leaves the message
pending for redelivery", but `StreamConsumer.read_batch` only ever asks Redis for `>`:
an entry that is never acknowledged is invisible to every later read of its group. Until
the workers opted into `reclaim_pending`, skipping the ACK therefore dropped the charge
(or the measurement AND its charge) silently, while the pending list grew forever.

These tests run against fakeredis so the pending-list bookkeeping is real Redis
consumer-group behaviour rather than a mock of it. They also pin the drop rule: an
envelope the worker cannot even read is dropped after `max_deliveries`, while a readable
one whose write path keeps failing is kept — money is never dropped because Postgres was
down for a while.
"""

import asyncio
from uuid import uuid4

import fakeredis.aioredis as fakeredis
import pytest

from ee.src.core.wallets.contracts import STREAM_DEBITS, STREAM_MEASUREMENTS
from ee.src.core.wallets.errors import SettlementUnavailableError
from ee.src.core.wallets.streaming import (
    serialize_debit_command,
    serialize_measurement_command,
)
from ee.src.tasks.asyncio.measurements.worker import MeasurementWorker
from ee.src.tasks.asyncio.wallets.worker import DebitWorker
from ee.tests.pytest.utils.measurements.fakes import (
    InMemoryDebitPublisher,
    InMemoryMeasurementsDAO,
    InMemoryOrganizationResolver,
)
from ee.tests.pytest.utils.wallets.builders import (
    build_debit_command,
    build_measurement_command,
)
from ee.tests.pytest.utils.wallets.fakes import FakeWalletSettlementPort

DEBITS_GROUP = "worker-debits"
MEASUREMENTS_GROUP = "worker-measurements"


async def _seed(redis_client, *, stream, group, entries):
    await redis_client.xgroup_create(
        name=stream, groupname=group, id="0", mkstream=True
    )
    for fields in entries:
        await redis_client.xadd(name=stream, fields=fields)


async def _pending(redis_client, *, stream, group):
    return await redis_client.xpending_range(
        name=stream, groupname=group, min="-", max="+", count=10
    )


def _debit_worker(*, redis_client, settlement_port, max_deliveries=5):
    return DebitWorker(
        settlement_port=settlement_port,
        redis_client=redis_client,
        consumer_name="test-consumer",
        reclaim_min_idle_ms=0,
        max_deliveries=max_deliveries,
    )


def _measurement_worker(*, redis_client, dao, publisher):
    return MeasurementWorker(
        measurements_dao=dao,
        organization_resolver=InMemoryOrganizationResolver(),
        debit_publisher=publisher,
        redis_client=redis_client,
        consumer_name="test-consumer",
        reclaim_min_idle_ms=0,
    )


@pytest.mark.asyncio
async def test_unsettled_debit_comes_back_through_the_reclaim_pass():
    command = build_debit_command(idempotency_key="gw_redelivered_once")
    redis_client = fakeredis.FakeRedis()
    await _seed(
        redis_client,
        stream=STREAM_DEBITS,
        group=DEBITS_GROUP,
        entries=[{"data": serialize_debit_command(command)}],
    )

    port = FakeWalletSettlementPort()
    port.raise_next = SettlementUnavailableError("db unavailable")
    worker = _debit_worker(redis_client=redis_client, settlement_port=port)

    batch = await worker.read_batch()
    assert len(batch) == 1
    _, acked_ids = await worker.process_batch(batch)
    assert acked_ids == []

    # `read_batch` only ever asks for `>`: without the reclaim pass this debit is gone.
    assert await worker.read_batch() == []

    await asyncio.sleep(0.01)
    reclaimed = await worker.reclaim_batch()
    assert [msg_id for msg_id, _ in reclaimed] == [msg_id for msg_id, _ in batch]

    _, acked_ids = await worker.process_batch(reclaimed)
    assert acked_ids == [batch[0][0]]
    await worker.ack_and_delete(acked_ids)

    # Redelivery is only safe because the settlement port is idempotent on
    # `idempotency_key`: two settle() attempts, exactly one financial effect.
    assert len(port.calls) == 2
    assert port.effects[(command.organization_id, command.idempotency_key)] == 1
    assert await redis_client.xlen(STREAM_DEBITS) == 0
    assert await _pending(redis_client, stream=STREAM_DEBITS, group=DEBITS_GROUP) == []


@pytest.mark.asyncio
async def test_unpublished_measurement_comes_back_through_the_reclaim_pass():
    command = build_measurement_command(endpoint_kind="managed")
    redis_client = fakeredis.FakeRedis()
    await _seed(
        redis_client,
        stream=STREAM_MEASUREMENTS,
        group=MEASUREMENTS_GROUP,
        entries=[{"data": serialize_measurement_command(command)}],
    )

    dao = InMemoryMeasurementsDAO()
    publisher = InMemoryDebitPublisher()
    publisher.fail_next = True
    worker = _measurement_worker(
        redis_client=redis_client, dao=dao, publisher=publisher
    )

    batch = await worker.read_batch()
    assert len(batch) == 1
    _, acked_ids = await worker.process_batch(batch)
    assert acked_ids == []
    assert publisher.published == []

    assert await worker.read_batch() == []

    await asyncio.sleep(0.01)
    reclaimed = await worker.reclaim_batch()
    assert [msg_id for msg_id, _ in reclaimed] == [msg_id for msg_id, _ in batch]

    _, acked_ids = await worker.process_batch(reclaimed)
    assert acked_ids == [batch[0][0]]
    await worker.ack_and_delete(acked_ids)

    # Redelivery is only safe because the measurement insert is idempotent on
    # `measurement_id` and the debit carries the derived key the settlement port
    # deduplicates on: two inserts attempted, one row, one debit.
    assert len(dao.insert_calls) == 2
    assert len(dao.rows) == 1
    assert len(publisher.published) == 1
    assert (
        publisher.published[0].idempotency_key
        == f"measurement:{command.measurement_id}"
    )
    assert (
        await _pending(
            redis_client, stream=STREAM_MEASUREMENTS, group=MEASUREMENTS_GROUP
        )
        == []
    )


@pytest.mark.asyncio
async def test_unreadable_debit_entry_is_dropped_after_max_deliveries(caplog):
    """An entry with no `data` field will never gain one — the one failure this worker
    knows is permanent, so `is_permanent_failure` lets the drop rule fire."""
    redis_client = fakeredis.FakeRedis()
    await _seed(
        redis_client,
        stream=STREAM_DEBITS,
        group=DEBITS_GROUP,
        entries=[{"not_data": b"no envelope here"}],
    )

    port = FakeWalletSettlementPort()
    worker = _debit_worker(
        redis_client=redis_client, settlement_port=port, max_deliveries=3
    )

    batch = await worker.read_batch()
    assert len(batch) == 1
    _, acked_ids = await worker.process_batch(batch)
    assert acked_ids == []

    for _ in range(6):
        await asyncio.sleep(0.01)
        reclaimed = await worker.reclaim_batch()
        if not reclaimed:
            break
        _, acked_ids = await worker.process_batch(reclaimed)
        await worker.ack_and_delete(acked_ids)

    assert worker.dropped_messages == 1
    assert port.calls == []
    assert await _pending(redis_client, stream=STREAM_DEBITS, group=DEBITS_GROUP) == []


@pytest.mark.asyncio
async def test_readable_debit_is_kept_pending_however_often_settlement_fails():
    """The opposite rule: a debit whose settlement path is down is NOT permanently
    invalid, so it keeps its place in the pending list instead of being dropped."""

    class _AlwaysFailingPort(FakeWalletSettlementPort):
        async def settle(self, command):
            self.calls.append(command)
            raise SettlementUnavailableError("db unavailable")

    command = build_debit_command(idempotency_key="gw_never_settles")
    redis_client = fakeredis.FakeRedis()
    await _seed(
        redis_client,
        stream=STREAM_DEBITS,
        group=DEBITS_GROUP,
        entries=[{"data": serialize_debit_command(command)}],
    )

    port = _AlwaysFailingPort()
    worker = _debit_worker(
        redis_client=redis_client, settlement_port=port, max_deliveries=2
    )

    batch = await worker.read_batch()
    await worker.process_batch(batch)

    for _ in range(5):
        await asyncio.sleep(0.01)
        reclaimed = await worker.reclaim_batch()
        assert [msg_id for msg_id, _ in reclaimed] == [msg_id for msg_id, _ in batch]
        await worker.process_batch(reclaimed)

    assert worker.dropped_messages == 0
    pending = await _pending(redis_client, stream=STREAM_DEBITS, group=DEBITS_GROUP)
    assert len(pending) == 1


def test_describe_message_names_the_posting_for_the_loss_log():
    command = build_debit_command(
        organization_id=uuid4(), idempotency_key="gw_traceable"
    )
    worker = _debit_worker(
        redis_client=fakeredis.FakeRedis(), settlement_port=FakeWalletSettlementPort()
    )

    described = worker.describe_message({b"data": serialize_debit_command(command)})

    assert described == f"{command.organization_id}:gw_traceable"
    assert worker.describe_message({b"data": b"not an envelope"}) is None
