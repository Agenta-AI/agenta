"""A wallet stream entry left pending must come back.

Both workers' `process_batch` promise that a retryable failure "leaves the message
pending for redelivery", but `StreamConsumer.read_batch` only ever asks Redis for `>`:
an entry that is never acknowledged is invisible to every later read of its group. Until
the workers opted into `reclaim_pending`, skipping the ACK therefore dropped the charge
(or the measurement AND its charge) silently, while the pending list grew forever.

These tests run against fakeredis so the pending-list bookkeeping is real Redis
consumer-group behaviour rather than a mock of it. They also pin the exit rule
(open-designs item 20): after `max_deliveries` an entry leaves the pending list for
`<stream>:dead`, readable or not, and a dead letter replays onto the stream it came from.
"""

import asyncio
from uuid import uuid4

import fakeredis.aioredis as fakeredis
import pytest

from oss.src.tasks.asyncio.shared.dead_letters import replay_dead_letters

import ee.src.dbs.redis.wallets.streams as wallet_streams
from ee.src.core.wallets.contracts import STREAM_DEBITS, STREAM_MEASUREMENTS
from ee.src.core.wallets.errors import SettlementUnavailableError
from ee.src.core.wallets.streaming import (
    serialize_debit_command,
    serialize_measurement_command,
)
from ee.src.dbs.redis.wallets.streams import RedisDebitPublisher
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


def _debit_worker(
    *, redis_client, settlement_port, max_deliveries=5, reclaim_min_idle_ms=0
):
    return DebitWorker(
        settlement_port=settlement_port,
        redis_client=redis_client,
        consumer_name="test-consumer",
        reclaim_min_idle_ms=reclaim_min_idle_ms,
        max_deliveries=max_deliveries,
    )


class _AlwaysFailingPort(FakeWalletSettlementPort):
    """Fails every posting whose key is in `failing`, settles the rest."""

    def __init__(self, failing=None):
        super().__init__()
        self.failing = failing

    async def settle(self, command):
        if self.failing is None or command.idempotency_key in self.failing:
            self.calls.append(command)
            raise SettlementUnavailableError("db unavailable")
        return await super().settle(command)


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


async def _drain_reclaims(worker, *, passes):
    for _ in range(passes):
        await asyncio.sleep(0.01)
        reclaimed = await worker.reclaim_batch()
        if not reclaimed:
            continue
        _, acked_ids = await worker.process_batch(reclaimed)
        await worker.ack_and_delete(acked_ids)


@pytest.mark.asyncio
async def test_unreadable_debit_entry_is_dead_lettered_after_max_deliveries():
    """An entry with no `data` field will never gain one. It leaves the pending list
    after `max_deliveries`, and is kept, not dropped."""
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
    _, acked_ids = await worker.process_batch(batch)
    assert acked_ids == []
    await _drain_reclaims(worker, passes=6)

    assert worker.dropped_messages == 0
    assert worker.dead_lettered_messages == 1
    assert port.calls == []
    assert await _pending(redis_client, stream=STREAM_DEBITS, group=DEBITS_GROUP) == []
    [(_, dead)] = await redis_client.xrange(f"{STREAM_DEBITS}:dead")
    assert dead[b"not_data"] == b"no envelope here"
    assert dead[b"dead_letter_reason"] == b"failed 3 deliveries"


@pytest.mark.asyncio
async def test_readable_debit_that_keeps_failing_is_dead_lettered_then_replayed():
    """A debit whose settlement keeps failing leaves the pending list after
    `max_deliveries` instead of pinning it forever, and replaying it once settlement
    works again charges it exactly once."""
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

    await worker.process_batch(await worker.read_batch())
    await _drain_reclaims(worker, passes=5)

    assert worker.dead_lettered_messages == 1
    assert await _pending(redis_client, stream=STREAM_DEBITS, group=DEBITS_GROUP) == []
    [(_, dead)] = await redis_client.xrange(f"{STREAM_DEBITS}:dead")
    assert dead[b"dead_letter_description"] == (
        f"{command.organization_id}:gw_never_settles".encode()
    )

    # The outage ends; the operator replays.
    port.failing = set()
    assert await replay_dead_letters(redis_client, stream=STREAM_DEBITS) == 1
    assert await redis_client.xlen(f"{STREAM_DEBITS}:dead") == 0

    replayed = await worker.read_batch()
    assert replayed[0][1] == {b"data": serialize_debit_command(command)}
    _, acked_ids = await worker.process_batch(replayed)
    await worker.ack_and_delete(acked_ids)
    assert port.effects[(command.organization_id, "gw_never_settles")] == 1
    assert await redis_client.xlen(STREAM_DEBITS) == 0


@pytest.mark.asyncio
async def test_failing_entries_at_the_head_do_not_hide_later_pending_entries():
    """Spec-review P2: the reclaim pass read only the 50 oldest pending entries per
    idle window, so 50 entries that keep failing hid every later one for good."""
    poison = [build_debit_command(idempotency_key=f"gw_poison_{i}") for i in range(60)]
    behind = build_debit_command(idempotency_key="gw_behind_the_head")
    redis_client = fakeredis.FakeRedis()
    await _seed(
        redis_client,
        stream=STREAM_DEBITS,
        group=DEBITS_GROUP,
        entries=[{"data": serialize_debit_command(c)} for c in [*poison, behind]],
    )

    # First delivery: everything fails (an outage), so all 61 are pending.
    port = _AlwaysFailingPort()
    worker = _debit_worker(
        redis_client=redis_client,
        settlement_port=port,
        # Large enough that no entry leaves for the dead letters during this test:
        # what is under test is reaching past the head, not the exit rule.
        max_deliveries=100,
        reclaim_min_idle_ms=20,
    )
    for _ in range(2):
        await worker.process_batch(await worker.read_batch())
    assert len(port.calls) == 61

    # The outage ends for every posting except the poison ones.
    port.failing = {c.idempotency_key for c in poison}
    for _ in range(6):
        await asyncio.sleep(0.03)
        reclaimed = await worker.reclaim_batch()
        if reclaimed:
            _, acked_ids = await worker.process_batch(reclaimed)
            await worker.ack_and_delete(acked_ids)

    assert port.effects.get((behind.organization_id, "gw_behind_the_head")) == 1


@pytest.mark.asyncio
async def test_debit_publish_refuses_past_the_backlog_limit_and_never_trims(
    monkeypatch,
):
    """Spec-review P2: `XADD MAXLEN` trimmed the oldest entries of a backlog, pending
    or not, without a log line. Past the limit the publish now fails loudly and every
    entry already in the stream stays."""
    redis_client = fakeredis.FakeRedis()
    monkeypatch.setattr(wallet_streams, "MAX_BACKLOG", 2)
    await redis_client.xgroup_create(
        name=STREAM_DEBITS, groupname=DEBITS_GROUP, id="0", mkstream=True
    )
    publisher = RedisDebitPublisher(redis_client=redis_client)

    assert await publisher.publish(build_debit_command()) is True
    assert await publisher.publish(build_debit_command()) is True
    await redis_client.xreadgroup(
        groupname=DEBITS_GROUP, consumername="c", streams={STREAM_DEBITS: ">"}
    )

    assert await publisher.publish(build_debit_command()) is False
    assert await redis_client.xlen(STREAM_DEBITS) == 2
    assert (
        len(await _pending(redis_client, stream=STREAM_DEBITS, group=DEBITS_GROUP)) == 2
    )


def test_describe_message_names_the_posting_for_the_dead_letter():
    command = build_debit_command(
        organization_id=uuid4(), idempotency_key="gw_traceable"
    )
    worker = _debit_worker(
        redis_client=fakeredis.FakeRedis(), settlement_port=FakeWalletSettlementPort()
    )

    described = worker.describe_message({b"data": serialize_debit_command(command)})

    assert described == f"{command.organization_id}:gw_traceable"
    assert worker.describe_message({b"data": b"not an envelope"}) is None
