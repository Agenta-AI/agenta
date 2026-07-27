"""M3 live relay — publish side (T1).

The records worker tees a change notification onto the per-session watch channel
strictly AFTER `append_many` commits, once per distinct (project, session) in the
batch. Publishing is fire-and-forget: an append failure publishes nothing (there
is nothing new to see), and a publish failure never fails the worker loop (the
DB write is already committed and must not be re-driven by relay errors).
"""

import json
import zlib
from unittest.mock import AsyncMock
from uuid import uuid4

import pytest
from orjson import dumps

from oss.src.core.sessions.records.service import RecordsService
from oss.src.core.sessions.records.dtos import SessionRecord
from oss.src.dbs.redis.sessions.contract import watch_channel
from oss.src.dbs.redis.sessions.watch import SessionsWatchPublisher
from oss.src.tasks.asyncio.sessions.records_worker import RecordsWorker


def _payload(*, project_id, session_id, record_index=0):
    message = {
        "organization_id": None,
        "project_id": str(project_id),
        "record_event": {
            "project_id": str(project_id),
            "session_id": session_id,
            "record_index": record_index,
        },
    }
    return zlib.compress(dumps(message))


class _RecordingPublisher:
    """Watch-publisher fake that records calls; `fail=True` simulates a broken relay."""

    def __init__(self, *, fail: bool = False, journal=None):
        self.calls: list[tuple[str, str]] = []
        self.fail = fail
        self.journal = journal

    async def records_changed(self, *, project_id: str, session_id: str) -> None:
        if self.fail:
            raise RuntimeError("relay down")
        self.calls.append((project_id, session_id))
        if self.journal is not None:
            self.journal.append(("publish", session_id))


def _worker(records_dao, publisher):
    return RecordsWorker(
        service=RecordsService(records_dao=records_dao),
        redis_client=None,
        stream_name="streams:records",
        consumer_group="worker-records",
        watch_publisher=publisher,
    )


@pytest.mark.asyncio
async def test_worker_publishes_once_per_session_after_append():
    project_id = uuid4()
    journal: list = []

    records_dao = AsyncMock()

    async def _append_many(*, events):
        journal.append(("append", len(events)))
        return [
            SessionRecord(
                record_id=uuid4(), session_id=e.session_id, project_id=project_id
            )
            for e in events
        ]

    records_dao.append_many = AsyncMock(side_effect=_append_many)

    publisher = _RecordingPublisher(journal=journal)
    worker = _worker(records_dao, publisher)

    batch = [
        (b"1-0", {b"data": _payload(project_id=project_id, session_id="sess-a")}),
        (
            b"2-0",
            {
                b"data": _payload(
                    project_id=project_id, session_id="sess-a", record_index=1
                )
            },
        ),
        (b"3-0", {b"data": _payload(project_id=project_id, session_id="sess-b")}),
    ]

    total_appended, processed_ids = await worker.process_batch(batch)

    assert total_appended == 3
    assert len(processed_ids) == 3
    # 2 distinct sessions -> exactly 2 publishes, never one per record.
    assert sorted(publisher.calls) == [
        (str(project_id), "sess-a"),
        (str(project_id), "sess-b"),
    ]
    # Strict ordering: the append committed before any publish fired.
    assert journal[0] == ("append", 3)
    assert all(entry[0] == "publish" for entry in journal[1:])


@pytest.mark.asyncio
async def test_worker_skips_publish_when_append_fails():
    project_id = uuid4()

    records_dao = AsyncMock()
    records_dao.append_many = AsyncMock(side_effect=RuntimeError("db down"))

    publisher = _RecordingPublisher()
    worker = _worker(records_dao, publisher)

    batch = [(b"1-0", {b"data": _payload(project_id=project_id, session_id="s")})]
    total_appended, processed_ids = await worker.process_batch(batch)

    assert total_appended == 0
    assert publisher.calls == []
    # Failed appends stay in the existing retry path; publish adds nothing to it.
    assert len(processed_ids) == 1


@pytest.mark.asyncio
async def test_worker_survives_publisher_failure():
    project_id = uuid4()

    records_dao = AsyncMock()
    records_dao.append_many = AsyncMock(return_value=[object()])

    worker = _worker(records_dao, _RecordingPublisher(fail=True))

    batch = [(b"1-0", {b"data": _payload(project_id=project_id, session_id="s")})]
    total_appended, processed_ids = await worker.process_batch(batch)

    # The committed append is still counted and acked; relay errors never re-drive it.
    assert total_appended == 1
    assert len(processed_ids) == 1


@pytest.mark.asyncio
async def test_publisher_publishes_on_watch_channel():
    import fakeredis

    redis = fakeredis.FakeAsyncRedis()
    pubsub = redis.pubsub()
    project_id = str(uuid4())
    channel = watch_channel(project_id, "sess-1")
    await pubsub.subscribe(channel)
    await pubsub.get_message(timeout=1)  # drain the subscribe confirmation

    publisher = SessionsWatchPublisher(redis_client=redis)
    await publisher.records_changed(project_id=project_id, session_id="sess-1")

    message = await pubsub.get_message(ignore_subscribe_messages=True, timeout=1)
    assert message is not None
    assert json.loads(message["data"]) == {
        "type": "records-changed",
        "session_id": "sess-1",
    }


@pytest.mark.asyncio
async def test_publisher_swallows_redis_failure():
    broken = AsyncMock()
    broken.publish = AsyncMock(side_effect=ConnectionError("redis gone"))

    publisher = SessionsWatchPublisher(redis_client=broken)
    # Must not raise — the relay is strictly best-effort.
    await publisher.records_changed(project_id="p", session_id="s")
    await publisher.lifecycle(project_id="p", session_id="s", state="running")
    await publisher.interaction(project_id="p", session_id="s", status="pending")
    assert broken.publish.await_count == 3
