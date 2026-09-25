"""Unit tests for SessionEventsWorker.process_batch — scaffold consumer that
proves streams:sessions is observable without polling.
"""

from uuid import uuid4

import pytest
from orjson import dumps

from oss.src.tasks.asyncio.sessions.events_worker import SessionEventsWorker


def _payload(*, kind, project_id, session_id, turn_id):
    return dumps(
        {
            "kind": kind,
            "project_id": str(project_id),
            "session_id": session_id,
            "turn_id": turn_id,
        }
    )


@pytest.mark.asyncio
async def test_process_batch_observes_turn_started_and_turn_ended():
    project_id = uuid4()
    turn_id = str(uuid4())

    worker = SessionEventsWorker(
        redis_client=None,
        stream_name="streams:sessions",
        consumer_group="worker-sessions",
    )

    batch = [
        (
            b"1-0",
            {
                b"data": _payload(
                    kind="turn_started",
                    project_id=project_id,
                    session_id="session-1",
                    turn_id=turn_id,
                )
            },
        ),
        (
            b"2-0",
            {
                b"data": _payload(
                    kind="turn_ended",
                    project_id=project_id,
                    session_id="session-1",
                    turn_id=turn_id,
                )
            },
        ),
    ]

    total, processed_ids = await worker.process_batch(batch)

    assert total == 2
    assert processed_ids == [b"1-0", b"2-0"]


@pytest.mark.asyncio
async def test_process_batch_acks_unparseable_messages_without_raising():
    worker = SessionEventsWorker(
        redis_client=None,
        stream_name="streams:sessions",
        consumer_group="worker-sessions",
    )

    batch = [(b"1-0", {b"data": b"not-json"})]

    total, processed_ids = await worker.process_batch(batch)

    assert total == 1
    assert processed_ids == [b"1-0"]
