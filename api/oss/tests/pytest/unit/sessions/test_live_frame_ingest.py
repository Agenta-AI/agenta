from datetime import datetime, timezone
from unittest.mock import AsyncMock, patch
from uuid import uuid4

import pytest
from fastapi import FastAPI, HTTPException, Request
from pydantic import TypeAdapter, ValidationError
from oss.src.apis.fastapi.sessions.models import (
    SessionRecordIngestBody,
    SessionRecordIngestRequest,
)
from oss.src.apis.fastapi.sessions.router import RecordsRouter
from oss.src.core.sessions.records.dtos import (
    MAX_LIVE_FRAME_BYTES,
    MessageCompletedEvent,
    SessionLiveFrame,
    SessionRecordEvent,
)
from oss.src.core.sessions.records.streaming import (
    LIVE_FRAME_STREAM_NAME,
    MAXLEN_STREAMS_RECORDS,
    RECORD_STREAM_NAME,
    publish_durable_event,
    publish_live_frame,
    publish_record,
    trim_live_stream,
)
from oss.src.tasks.asyncio.sessions.records_worker import RecordsWorker
from oss.src.utils.env import env


def _request(
    project_id, user_id, organization_id, *, content_length: int | None = None
) -> Request:
    headers = []
    if content_length is not None:
        headers.append((b"content-length", str(content_length).encode()))
    request = Request(
        {
            "type": "http",
            "method": "POST",
            "path": "/sessions/records/ingest",
            "headers": headers,
            "app": FastAPI(),
        }
    )
    request.state.project_id = str(project_id)
    request.state.user_id = str(user_id)
    request.state.organization_id = str(organization_id)
    return request


def _frame(
    session_id: str = "session-1",
    execution_id: str = "execution-1",
    payload: dict | None = None,
    frame_index: int = 0,
):
    return SessionRecordIngestRequest(
        version=1,
        kind="frame",
        session_id=session_id,
        execution_id=execution_id,
        frame_or_event_id=f"{execution_id}:{frame_index}",
        frame_index=frame_index,
        entity_id="message-1",
        type="text-delta",
        payload=payload or {"id": "message-1", "delta": "hello"},
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


async def test_frame_ingest_accepts_a_batch_and_publishes_in_order():
    project_id = uuid4()
    user_id = uuid4()
    organization_id = uuid4()
    router = RecordsRouter(records_service=AsyncMock())
    payload = [_frame(frame_index=index).model_dump(mode="json") for index in range(3)]
    body = TypeAdapter(SessionRecordIngestBody).validate_python(payload)

    assert isinstance(body, list)
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
            body=body,
        )

    assert result == {"ok": True}
    current.assert_awaited_once()
    assert [call.kwargs["frame"].frame_index for call in publish.await_args_list] == [
        0,
        1,
        2,
    ]


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


def test_frame_request_rejects_oversized_serialized_payload():
    with pytest.raises(ValidationError, match="serialized live frame exceeds"):
        _frame(payload={"delta": "x" * MAX_LIVE_FRAME_BYTES})


async def test_frame_ingest_rejects_oversized_content_length():
    router = RecordsRouter(records_service=AsyncMock())
    owner = AsyncMock()
    publish = AsyncMock()
    with (
        patch(
            "oss.src.apis.fastapi.sessions.router.check_action_access",
            new_callable=AsyncMock,
            return_value=True,
        ),
        patch(
            "oss.src.apis.fastapi.sessions.router.get_running_owner",
            owner,
        ),
        patch(
            "oss.src.apis.fastapi.sessions.router.publish_live_frame",
            publish,
        ),
    ):
        with pytest.raises(HTTPException) as exc_info:
            await router.ingest_record_event(
                request=_request(
                    uuid4(),
                    uuid4(),
                    uuid4(),
                    content_length=MAX_LIVE_FRAME_BYTES + 1,
                ),
                body=_frame(),
            )

    assert exc_info.value.status_code == 413
    owner.assert_not_awaited()
    publish.assert_not_awaited()


async def test_publish_frame_rejects_oversized_mutated_payload():
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
    frame.payload = {"delta": "x" * MAX_LIVE_FRAME_BYTES}

    with patch(
        "oss.src.core.sessions.records.streaming._get_redis", return_value=redis
    ):
        assert not await publish_live_frame(project_id=uuid4(), frame=frame)

    redis.xadd.assert_not_awaited()


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
    # The live stream carries disposable frames, so trimming is approximate on the hot path.
    assert xadd["approximate"] is True
    redis.xtrim.assert_awaited_once()
    assert redis.xtrim.await_args.kwargs["approximate"] is True


async def test_publish_durable_event_uses_dedicated_bounded_stream():
    redis = AsyncMock()
    event = MessageCompletedEvent.model_validate(
        {
            "session_id": "session-1",
            "execution_id": "execution-1",
            "frame_or_event_id": "event-1",
            "entity_id": "message-1",
            "sequence": 1,
            "watermark": 1,
            "type": "message.completed",
            "payload": {
                "message_id": "message-1",
                "role": "assistant",
                "content": "hello",
            },
            "created_at": datetime.now(timezone.utc),
        }
    )
    with (
        patch("oss.src.core.sessions.records.streaming._get_redis", return_value=redis),
        patch.object(env.sessions, "live_stream_maxlen", 4),
    ):
        assert await publish_durable_event(project_id=uuid4(), event=event)

    xadd = redis.xadd.await_args.kwargs
    assert xadd["name"] == LIVE_FRAME_STREAM_NAME
    assert xadd["name"] != RECORD_STREAM_NAME
    assert xadd["maxlen"] == 4
    assert xadd["approximate"] is True


async def test_publish_record_preserves_flag_off_retention_bound():
    redis = AsyncMock()
    project_id = uuid4()
    record = SessionRecordEvent(
        project_id=project_id,
        session_id="session-1",
        record_type="message",
        attributes={"type": "text", "text": "hello"},
    )
    with (
        patch("oss.src.core.sessions.records.streaming._get_redis", return_value=redis),
        patch.object(env.sessions, "shared_reader", False),
    ):
        assert await publish_record(project_id=project_id, record_event=record)

    xadd = redis.xadd.await_args.kwargs
    assert xadd["name"] == RECORD_STREAM_NAME
    assert xadd["maxlen"] == MAXLEN_STREAMS_RECORDS
    assert xadd["approximate"] is True


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
