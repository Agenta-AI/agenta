"""Pins the connection-pool-exhaustion invariant for the records stream worker.

`RecordsWorker.process_batch` used to call `RecordsService.append` once PER EVENT
inside a per-project loop; `RecordsDAO.append` opens its own DB session on every
call, so a batch of N events across the same project opened N connections. The fix
batches all events for a project group into one `append_many` call that upserts via
a single statement in a single session. This test asserts the CALL COUNT into the
service/DAO layer, not just that records got persisted — a result-only test would
still pass with the old one-append-per-event code.
"""

from unittest.mock import AsyncMock
from uuid import uuid4
import zlib

import pytest
from orjson import dumps

from oss.src.core.sessions.records.dtos import SessionRecordEvent, SessionRecord
from oss.src.core.sessions.records.service import RecordsService
from oss.src.tasks.asyncio.sessions.records_worker import RecordsWorker


def _payload(*, project_id, session_id, record_index):
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


@pytest.mark.asyncio
async def test_process_batch_appends_once_per_project_not_per_event():
    project_id = uuid4()

    records_dao = AsyncMock()
    records_dao.append_many = AsyncMock(
        return_value=[
            SessionRecord(record_id=uuid4(), session_id="sess-1", project_id=project_id)
            for _ in range(3)
        ]
    )
    records_dao.append = AsyncMock()

    service = RecordsService(records_dao=records_dao)
    worker = RecordsWorker(
        service=service,
        redis_client=None,  # not used by process_batch
        stream_name="streams:records",
        consumer_group="worker-records",
    )

    batch = [
        (
            f"{i}-0".encode(),
            {
                b"data": _payload(
                    project_id=project_id, session_id="sess-1", record_index=i
                )
            },
        )
        for i in range(3)
    ]

    total_appended, processed_ids = await worker.process_batch(batch)

    assert total_appended == 3
    assert len(processed_ids) == 3
    # 3 events, same project -> exactly one append_many call, not 3 append calls.
    records_dao.append_many.assert_awaited_once()
    called_events = records_dao.append_many.await_args.kwargs["events"]
    assert len(called_events) == 3
    assert all(isinstance(e, SessionRecordEvent) for e in called_events)
    records_dao.append.assert_not_awaited()


@pytest.mark.asyncio
async def test_process_batch_groups_by_project_one_append_many_per_project():
    project_a = uuid4()
    project_b = uuid4()

    records_dao = AsyncMock()
    records_dao.append_many = AsyncMock(return_value=[])
    records_dao.append = AsyncMock()

    service = RecordsService(records_dao=records_dao)
    worker = RecordsWorker(
        service=service,
        redis_client=None,
        stream_name="streams:records",
        consumer_group="worker-records",
    )

    batch = [
        (
            b"1-0",
            {b"data": _payload(project_id=project_a, session_id="s", record_index=0)},
        ),
        (
            b"2-0",
            {b"data": _payload(project_id=project_a, session_id="s", record_index=1)},
        ),
        (
            b"3-0",
            {b"data": _payload(project_id=project_b, session_id="s", record_index=0)},
        ),
    ]

    await worker.process_batch(batch)

    # 2 distinct projects -> exactly 2 append_many calls (one per project group),
    # never one per event (which would be 3).
    assert records_dao.append_many.await_count == 2
    records_dao.append.assert_not_awaited()
