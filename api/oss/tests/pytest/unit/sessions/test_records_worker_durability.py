"""Records must not be acknowledged before Postgres has them (#5496, #5594).

`RecordsWorker.process_batch` used to add every decoded Redis message id to its
acknowledged list DURING deserialization, before `append_many` ran. A failed write logged
and continued, and the shared consumer loop then acknowledged and deleted those messages
from the stream. Every Postgres hiccup was therefore permanent, silent record loss, and one
record Postgres rejected took its whole batch with it.

These tests pin three properties:

* a message id is acknowledged only after its rows commit, and the redelivered batch is
  written exactly once;
* one bad record does not discard the rest of its batch;
* a message that never writes is dropped loudly and counted, instead of holding the
  pending list forever.

The redelivery tests run against fakeredis so the pending-list bookkeeping is real Redis
consumer-group behaviour, not a mock of it.
"""

import asyncio
import zlib
from types import SimpleNamespace
from unittest.mock import AsyncMock
from uuid import uuid4

import fakeredis.aioredis as fakeredis
import pytest
from orjson import dumps

from oss.src.core.sessions.records.dtos import SessionRecord
from oss.src.core.sessions.records.service import RecordsService
from oss.src.tasks.asyncio.sessions import records_worker
from oss.src.tasks.asyncio.sessions.records_worker import RecordsWorker

STREAM = "streams:records"
GROUP = "worker-records"


def _payload(*, project_id, session_id, record_id, record_type="message", turn_id=None):
    message = {
        "organization_id": None,
        "project_id": str(project_id),
        "record_event": {
            "project_id": str(project_id),
            "session_id": session_id,
            "record_id": str(record_id),
            "record_type": record_type,
            "turn_id": turn_id,
        },
    }
    return zlib.compress(dumps(message))


class FakeRecordsDAO:
    """Records what committed, and fails the events the caller names."""

    def __init__(self, *, poison_ids=(), fail_calls=0):
        self.poison_ids = {str(record_id) for record_id in poison_ids}
        self.fail_calls = fail_calls
        self.calls = 0
        self.committed: list[str] = []

    async def append_many(self, *, events):
        self.calls += 1
        if self.calls <= self.fail_calls:
            raise RuntimeError("postgres is down")
        if any(str(event.record_id) in self.poison_ids for event in events):
            # `append_many` is one statement in one transaction: a rejected row takes the
            # whole call with it, and nothing in the call commits.
            raise RuntimeError("record rejected")
        for event in events:
            self.committed.append(str(event.record_id))
        return [
            SessionRecord(
                record_id=event.record_id,
                session_id=event.session_id,
                project_id=event.project_id,
            )
            for event in events
        ]


def _worker(dao, *, redis_client=None, max_deliveries=5):
    return RecordsWorker(
        service=RecordsService(records_dao=dao),
        redis_client=redis_client,
        stream_name=STREAM,
        consumer_group=GROUP,
        consumer_name="test-consumer",
        reclaim_min_idle_ms=0,
        max_deliveries=max_deliveries,
    )


def _batch(*, project_id, record_ids):
    return [
        (
            f"{index}-0".encode(),
            {
                b"data": _payload(
                    project_id=project_id, session_id="sess-1", record_id=record_id
                )
            },
        )
        for index, record_id in enumerate(record_ids)
    ]


@pytest.mark.asyncio
async def test_failed_batch_acknowledges_nothing():
    project_id = uuid4()
    record_ids = [uuid4(), uuid4()]
    dao = FakeRecordsDAO(fail_calls=99)

    appended, acked_ids = await _worker(dao).process_batch(
        _batch(project_id=project_id, record_ids=record_ids)
    )

    assert appended == 0
    # Nothing committed, so nothing may be acknowledged: the shared consumer loop deletes
    # every id this list carries.
    assert acked_ids == []
    assert dao.committed == []


@pytest.mark.asyncio
async def test_redelivered_batch_is_acknowledged_once_and_written_once():
    project_id = uuid4()
    record_ids = [uuid4(), uuid4()]
    batch = _batch(project_id=project_id, record_ids=record_ids)
    # The whole-batch call fails, then the per-record retry fails twice, then Postgres is back.
    dao = FakeRecordsDAO(fail_calls=3)
    worker = _worker(dao)

    _, first_acked = await worker.process_batch(batch)
    assert first_acked == []

    appended, second_acked = await worker.process_batch(batch)

    assert appended == 2
    assert second_acked == [msg_id for msg_id, _ in batch]
    assert dao.committed == [str(record_id) for record_id in record_ids]
    assert worker.dropped_messages == 0


@pytest.mark.asyncio
async def test_one_bad_record_does_not_discard_its_batch():
    project_id = uuid4()
    good_a, poison, good_b = uuid4(), uuid4(), uuid4()
    batch = _batch(project_id=project_id, record_ids=[good_a, poison, good_b])
    dao = FakeRecordsDAO(poison_ids=[poison])

    appended, acked_ids = await _worker(dao).process_batch(batch)

    assert appended == 2
    assert dao.committed == [str(good_a), str(good_b)]
    # Only the two good ids are acknowledged. The rejected record stays pending.
    assert acked_ids == [batch[0][0], batch[2][0]]


@pytest.mark.asyncio
async def test_undecodable_message_is_acknowledged_and_counted():
    dao = FakeRecordsDAO()
    worker = _worker(dao)

    appended, acked_ids = await worker.process_batch([(b"1-0", {b"data": b"not-zlib"})])

    assert appended == 0
    # A message that does not decode will not decode on redelivery, so it is dropped on
    # purpose rather than left to hold the pending list.
    assert acked_ids == [b"1-0"]
    assert worker.dropped_messages == 1


@pytest.mark.asyncio
async def test_watch_and_gate_reconciliation_see_only_committed_records():
    project_id = uuid4()
    good, poison = uuid4(), uuid4()
    batch = [
        (
            b"1-0",
            {
                b"data": _payload(
                    project_id=project_id,
                    session_id="sess-good",
                    record_id=good,
                    record_type="done",
                    turn_id="turn-good",
                )
            },
        ),
        (
            b"2-0",
            {
                b"data": _payload(
                    project_id=project_id,
                    session_id="sess-poison",
                    record_id=poison,
                    record_type="done",
                    turn_id="turn-poison",
                )
            },
        ),
    ]

    watch_publisher = AsyncMock()
    interactions_service = AsyncMock()
    interactions_service.cancel_session_pending = AsyncMock(return_value=0)

    worker = RecordsWorker(
        service=RecordsService(records_dao=FakeRecordsDAO(poison_ids=[poison])),
        redis_client=None,
        stream_name=STREAM,
        consumer_group=GROUP,
        watch_publisher=watch_publisher,
        interactions_service=interactions_service,
    )

    await worker.process_batch(batch)

    # A record that never committed must not wake a client or cancel a gate: the reader it
    # would send to Postgres cannot see the row.
    notified = {
        call.kwargs["session_id"]
        for call in watch_publisher.records_changed.await_args_list
    }
    assert notified == {"sess-good"}
    reconciled = {
        call.kwargs["session_id"]
        for call in interactions_service.cancel_session_pending.await_args_list
    }
    assert reconciled == {"sess-good"}


async def _seed(redis_client, payloads):
    await redis_client.xgroup_create(
        name=STREAM, groupname=GROUP, id="0", mkstream=True
    )
    for payload in payloads:
        await redis_client.xadd(name=STREAM, fields={"data": payload})


@pytest.mark.asyncio
async def test_unacknowledged_entry_comes_back_through_the_reclaim_pass():
    project_id = uuid4()
    record_id = uuid4()
    redis_client = fakeredis.FakeRedis()
    await _seed(
        redis_client,
        [_payload(project_id=project_id, session_id="s", record_id=record_id)],
    )

    dao = FakeRecordsDAO(fail_calls=1)
    worker = _worker(dao, redis_client=redis_client)

    batch = await worker.read_batch()
    assert len(batch) == 1
    _, acked_ids = await worker.process_batch(batch)
    assert acked_ids == []

    # `read_batch` only ever asks for `>`, so without the reclaim pass this entry is invisible
    # to every later read and the "leave it pending" fix would lose it silently.
    assert await worker.read_batch() == []

    await asyncio.sleep(0.01)
    reclaimed = await worker.reclaim_batch()
    assert [msg_id for msg_id, _ in reclaimed] == [msg_id for msg_id, _ in batch]

    _, acked_ids = await worker.process_batch(reclaimed)
    assert acked_ids == [batch[0][0]]
    await worker.ack_and_delete(acked_ids)

    assert dao.committed == [str(record_id)]
    assert await redis_client.xlen(STREAM) == 0
    pending = await redis_client.xpending_range(
        name=STREAM, groupname=GROUP, min="-", max="+", count=10
    )
    assert pending == []


@pytest.mark.asyncio
async def test_a_record_that_never_writes_is_dropped_loudly_and_counted(caplog):
    project_id = uuid4()
    good, poison = uuid4(), uuid4()
    redis_client = fakeredis.FakeRedis()
    await _seed(
        redis_client,
        [
            _payload(project_id=project_id, session_id="s", record_id=good),
            _payload(
                project_id=project_id,
                session_id="doomed-session",
                record_id=poison,
                record_type="done",
            ),
        ],
    )

    dao = FakeRecordsDAO(poison_ids=[poison])
    worker = _worker(dao, redis_client=redis_client, max_deliveries=3)

    batch = await worker.read_batch()
    _, acked_ids = await worker.process_batch(batch)
    await worker.ack_and_delete(acked_ids)

    for _ in range(6):
        await asyncio.sleep(0.01)
        reclaimed = await worker.reclaim_batch()
        if not reclaimed:
            break
        _, acked_ids = await worker.process_batch(reclaimed)
        await worker.ack_and_delete(acked_ids)

    assert dao.committed == [str(good)]
    assert worker.dropped_messages == 1
    pending = await redis_client.xpending_range(
        name=STREAM, groupname=GROUP, min="-", max="+", count=10
    )
    # The poison entry is gone, so it stops costing a write attempt every window.
    assert pending == []

    dropped = [
        record
        for record in caplog.records
        if "Dropping messages after repeated delivery failures" in record.getMessage()
    ]
    assert dropped, "the loss must be logged at error level"
    assert dropped[0].levelname == "ERROR"
    # The log names the lost record so the loss is traceable after the fact.
    assert worker.describe_message(batch[1][1]) == f"doomed-session:{poison}:done"


@pytest.mark.asyncio
async def test_nothing_is_dropped_while_the_write_path_is_down():
    """A long outage must not consume the drop budget.

    The delivery counter cannot tell a rejected record apart from an unreachable database, so
    dropping on the count alone would delete every record in flight once an outage outlasts
    `max_deliveries` windows. That is exactly the loss this worker exists to prevent.
    """
    project_id = uuid4()
    record_ids = [uuid4(), uuid4()]
    redis_client = fakeredis.FakeRedis()
    await _seed(
        redis_client,
        [
            _payload(project_id=project_id, session_id="s", record_id=record_id)
            for record_id in record_ids
        ],
    )

    dao = FakeRecordsDAO(fail_calls=99)
    worker = _worker(dao, redis_client=redis_client, max_deliveries=2)

    batch = await worker.read_batch()
    await worker.process_batch(batch)

    for _ in range(6):
        await asyncio.sleep(0.01)
        reclaimed = await worker.reclaim_batch()
        assert len(reclaimed) == 2
        await worker.process_batch(reclaimed)

    assert worker.dropped_messages == 0
    assert await redis_client.xlen(STREAM) == 2

    # Postgres comes back. Both records land, and neither was deleted meanwhile.
    dao.fail_calls = 0
    await asyncio.sleep(0.01)
    reclaimed = await worker.reclaim_batch()
    _, acked_ids = await worker.process_batch(reclaimed)
    await worker.ack_and_delete(acked_ids)

    assert dao.committed == [str(record_id) for record_id in record_ids]
    assert await redis_client.xlen(STREAM) == 0


@pytest.mark.asyncio
async def test_describe_message_survives_an_undecodable_payload():
    assert _worker(FakeRecordsDAO()).describe_message({b"data": b"not-zlib"}) is None


def _fake_ee(monkeypatch, *, allowed=True, raises=False):
    """Run the EE quota branch of `process_batch` without an EE build."""

    async def check_entitlements(**_):
        if raises:
            raise RuntimeError("entitlements unreachable")
        return allowed, None, None

    monkeypatch.setattr(records_worker, "is_ee", lambda: True)
    monkeypatch.setattr(
        records_worker, "check_entitlements", check_entitlements, raising=False
    )
    monkeypatch.setattr(
        records_worker,
        "Counter",
        SimpleNamespace(RECORDS_INGESTED="records"),
        raising=False,
    )
    monkeypatch.setattr(
        records_worker, "scope_from", lambda **kwargs: kwargs, raising=False
    )


def _org_batch(*, organization_id, project_id, record_id):
    message = {
        "organization_id": str(organization_id),
        "project_id": str(project_id),
        "record_event": {
            "project_id": str(project_id),
            "session_id": "sess-1",
            "record_id": str(record_id),
            "record_type": "message",
        },
    }
    return [(b"1-0", {b"data": zlib.compress(dumps(message))})]


@pytest.mark.asyncio
async def test_over_quota_org_is_acknowledged_and_counted(monkeypatch):
    _fake_ee(monkeypatch, allowed=False)
    dao = FakeRecordsDAO()
    worker = _worker(dao)

    _, acked_ids = await worker.process_batch(
        _org_batch(organization_id=uuid4(), project_id=uuid4(), record_id=uuid4())
    )

    # Over quota is a deliberate product drop, so redelivering it would spin forever.
    assert acked_ids == [b"1-0"]
    assert worker.dropped_messages == 1
    assert dao.committed == []


@pytest.mark.asyncio
async def test_unreachable_quota_meter_leaves_the_record_pending(monkeypatch):
    _fake_ee(monkeypatch, raises=True)
    dao = FakeRecordsDAO()
    worker = _worker(dao)

    _, acked_ids = await worker.process_batch(
        _org_batch(organization_id=uuid4(), project_id=uuid4(), record_id=uuid4())
    )

    # The meter was unreachable, not exceeded. Deleting the record would turn an
    # entitlements outage into a deleted conversation.
    assert acked_ids == []
    assert worker.dropped_messages == 0
    assert dao.committed == []
