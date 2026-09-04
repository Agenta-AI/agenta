from datetime import datetime, timezone
from unittest.mock import AsyncMock, patch
from uuid import uuid4

import pytest
from fastapi import FastAPI, HTTPException, Request
from oss.src.apis.fastapi.sessions.models import SessionRecordIngestRequest
from oss.src.apis.fastapi.sessions.router import RecordsRouter
from oss.src.core.sessions.records.dtos import SessionLiveFrame
from oss.src.core.sessions.records.streaming import (
    LIVE_FRAME_STREAM_NAME,
    RECORD_STREAM_NAME,
    publish_live_frame,
    trim_live_stream,
)
from oss.src.tasks.asyncio.sessions.records_worker import RecordsWorker
from oss.src.utils.env import env


def _request(project_id, user_id, organization_id) -> Request:
    request = Request(
        {
            "type": "http",
            "method": "POST",
            "path": "/sessions/records/ingest",
            "headers": [],
            "app": FastAPI(),
        }
    )
    request.state.project_id = str(project_id)
    request.state.user_id = str(user_id)
    request.state.organization_id = str(organization_id)
    return request


def _frame(session_id: str = "session-1", execution_id: str = "execution-1"):
    return SessionRecordIngestRequest(
        version=1,
        kind="frame",
        session_id=session_id,
        execution_id=execution_id,
        frame_or_event_id=f"{execution_id}:0",
        frame_index=0,
        entity_id="message-1",
        type="text-delta",
        payload={"id": "message-1", "delta": "hello"},
        created_at=datetime.now(timezone.utc),
    )


async def test_frame_ingest_checks_current_execution_and_publishes():
    project_id = uuid4()
    user_id = uuid4()
    organization_id = uuid4()
    router = RecordsRouter(records_service=AsyncMock())

    with (
        patch(
            "oss.src.apis.fastapi.sessions.router.check_action_access",
            new_callable=AsyncMock,
            return_value=True,
        ),
        patch(
            "oss.src.apis.fastapi.sessions.router.get_running_owner",
            new_callable=AsyncMock,
            return_value="execution-1",
        ) as current,
        patch(
            "oss.src.apis.fastapi.sessions.router.publish_live_frame",
            new_callable=AsyncMock,
            return_value=True,
        ) as publish,
    ):
        result = await router.ingest_record_event(
            request=_request(project_id, user_id, organization_id),
            body=_frame(),
        )

    assert result == {"ok": True}
    current.assert_awaited_once()
    published = publish.await_args.kwargs["frame"]
    assert published.execution_id == "execution-1"
    assert published.type == "text-delta"


async def test_frame_ingest_rejects_a_stale_execution():
    router = RecordsRouter(records_service=AsyncMock())
    with (
        patch(
            "oss.src.apis.fastapi.sessions.router.check_action_access",
            new_callable=AsyncMock,
            return_value=True,
        ),
        patch(
            "oss.src.apis.fastapi.sessions.router.get_running_owner",
            new_callable=AsyncMock,
            return_value="execution-new",
        ),
        patch(
            "oss.src.apis.fastapi.sessions.router.publish_live_frame",
            new_callable=AsyncMock,
        ) as publish,
    ):
        with pytest.raises(HTTPException) as exc_info:
            await router.ingest_record_event(
                request=_request(uuid4(), uuid4(), uuid4()),
                body=_frame(execution_id="execution-stale"),
            )

    assert exc_info.value.status_code == 403
    publish.assert_not_awaited()


async def test_publish_frame_uses_dedicated_bounded_stream():
    redis = AsyncMock()
    frame = SessionLiveFrame(
        version=1,
        kind="frame",
        session_id="session-1",
        execution_id="execution-1",
        frame_or_event_id="execution-1:0",
        frame_index=0,
        entity_id="message-1",
        type="text-delta",
        payload={"delta": "hello"},
        created_at=datetime.now(timezone.utc),
    )
    with (
        patch("oss.src.core.sessions.records.streaming._get_redis", return_value=redis),
        patch.object(env.sessions, "live_stream_maxlen", 4),
    ):
        assert await publish_live_frame(project_id=uuid4(), frame=frame)

    xadd = redis.xadd.await_args.kwargs
    assert xadd["name"] == LIVE_FRAME_STREAM_NAME
    assert isinstance(xadd["fields"]["data"], bytes)
    assert xadd["maxlen"] == 4
    assert xadd["approximate"] is False
    redis.xtrim.assert_awaited_once()


async def test_records_worker_deletes_malformed_entries_after_ack():
    redis = AsyncMock()
    worker = RecordsWorker(
        service=AsyncMock(),
        redis_client=redis,
        stream_name=RECORD_STREAM_NAME,
        consumer_group="worker-records",
    )

    appended, processed = await worker.process_batch(
        [(b"1-0", {b"data": b"not-a-compressed-record"})]
    )
    await worker.ack_and_delete(processed)

    assert appended == 0
    assert processed == [b"1-0"]
    redis.xack.assert_awaited_once_with(RECORD_STREAM_NAME, "worker-records", b"1-0")
    redis.xdel.assert_awaited_once_with(RECORD_STREAM_NAME, b"1-0")


async def test_live_frame_count_bound_does_not_touch_durable_records():
    fakeredis = pytest.importorskip("fakeredis")
    redis = fakeredis.FakeAsyncRedis()
    durable_id = await redis.xadd(RECORD_STREAM_NAME, {"data": b"durable"})

    with (
        patch("oss.src.core.sessions.records.streaming._get_redis", return_value=redis),
        patch.object(env.sessions, "live_stream_maxlen", 4),
    ):
        for index in range(5):
            frame = SessionLiveFrame.model_validate(
                {
                    **_frame().model_dump(),
                    "frame_or_event_id": f"execution-1:{index}",
                    "frame_index": index,
                }
            )
            assert await publish_live_frame(project_id=uuid4(), frame=frame)

    assert await redis.xlen(LIVE_FRAME_STREAM_NAME) == 4
    assert await redis.xrange(RECORD_STREAM_NAME, min=durable_id, max=durable_id)


async def test_age_trim_removes_expired_frames_from_live_stream():
    fakeredis = pytest.importorskip("fakeredis")
    redis = fakeredis.FakeAsyncRedis()
    expired_id = f"{int(datetime.now(timezone.utc).timestamp() * 1000) - 901_000}-0"
    await redis.xadd(LIVE_FRAME_STREAM_NAME, {"data": b"expired-frame"}, id=expired_id)

    with patch.object(env.sessions, "live_frame_max_age_seconds", 900):
        await trim_live_stream(redis)

    assert (
        await redis.xrange(LIVE_FRAME_STREAM_NAME, min=expired_id, max=expired_id) == []
    )
