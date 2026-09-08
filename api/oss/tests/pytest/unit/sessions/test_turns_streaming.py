"""Unit tests for tasks/asyncio/sessions/streaming.py — publish_turn_started,
publish_turn_ended, deserialize_turn_event.

Mirrors core/sessions/records/streaming.py's test shape: no real Redis, a fake
client observes what gets xadd-ed onto the stream.
"""

from unittest.mock import AsyncMock, patch
from uuid import UUID, uuid4

import pytest
from orjson import loads

from oss.src.tasks.asyncio.sessions.streaming import (
    deserialize_turn_event,
    publish_turn_ended,
    publish_turn_started,
)


class _FakeRedis:
    def __init__(self):
        self.xadd = AsyncMock()


@pytest.mark.asyncio
async def test_publish_turn_started_xadds_expected_shape():
    redis = _FakeRedis()
    project_id = uuid4()
    turn_id = str(uuid4())

    with patch(
        "oss.src.tasks.asyncio.sessions.streaming._get_redis", return_value=redis
    ):
        ok = await publish_turn_started(
            project_id=project_id,
            session_id="session-1",
            turn_id=turn_id,
        )

    assert ok is True
    redis.xadd.assert_awaited_once()
    call = redis.xadd.await_args.kwargs
    assert call["name"] == "streams:sessions"

    payload = loads(call["fields"]["data"])
    assert payload["kind"] == "turn_started"
    assert payload["project_id"] == str(project_id)
    assert payload["session_id"] == "session-1"
    assert payload["turn_id"] == turn_id


@pytest.mark.asyncio
async def test_publish_turn_ended_xadds_expected_shape():
    redis = _FakeRedis()
    project_id = uuid4()
    turn_id = str(uuid4())

    with patch(
        "oss.src.tasks.asyncio.sessions.streaming._get_redis", return_value=redis
    ):
        ok = await publish_turn_ended(
            project_id=project_id,
            session_id="session-1",
            turn_id=turn_id,
        )

    assert ok is True
    payload = loads(redis.xadd.await_args.kwargs["fields"]["data"])
    assert payload["kind"] == "turn_ended"
    assert payload["session_id"] == "session-1"
    assert payload["turn_id"] == turn_id


@pytest.mark.asyncio
async def test_publish_turn_started_no_op_when_redis_unset():
    with patch(
        "oss.src.tasks.asyncio.sessions.streaming._get_redis", return_value=None
    ):
        ok = await publish_turn_started(
            project_id=uuid4(),
            session_id="session-1",
            turn_id=str(uuid4()),
        )

    assert ok is False


@pytest.mark.asyncio
async def test_publish_turn_ended_no_op_when_redis_unset():
    with patch(
        "oss.src.tasks.asyncio.sessions.streaming._get_redis", return_value=None
    ):
        ok = await publish_turn_ended(
            project_id=uuid4(),
            session_id="session-1",
            turn_id=str(uuid4()),
        )

    assert ok is False


@pytest.mark.asyncio
async def test_publish_turn_started_swallows_redis_errors():
    redis = _FakeRedis()
    redis.xadd.side_effect = RuntimeError("boom")

    with patch(
        "oss.src.tasks.asyncio.sessions.streaming._get_redis", return_value=redis
    ):
        ok = await publish_turn_started(
            project_id=uuid4(),
            session_id="session-1",
            turn_id=str(uuid4()),
        )

    assert ok is False


def test_deserialize_turn_event_round_trips():
    project_id = uuid4()
    turn_id = str(uuid4())
    from orjson import dumps

    payload = dumps(
        {
            "kind": "turn_ended",
            "project_id": str(project_id),
            "session_id": "session-1",
            "turn_id": turn_id,
        }
    )

    turn_event = deserialize_turn_event(payload=payload)

    assert turn_event.kind == "turn_ended"
    assert turn_event.project_id == UUID(str(project_id))
    assert turn_event.session_id == "session-1"
    assert turn_event.turn_id == turn_id
