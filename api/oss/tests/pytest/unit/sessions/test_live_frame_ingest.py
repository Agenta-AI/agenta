import zlib
from datetime import datetime, timezone
from unittest.mock import AsyncMock, patch
from uuid import uuid4

import pytest
from fastapi import FastAPI, HTTPException, Request
from orjson import dumps

from oss.src.apis.fastapi.sessions.models import SessionRecordIngestRequest
from oss.src.apis.fastapi.sessions.router import RecordsRouter
from oss.src.core.sessions.records.dtos import SessionLiveFrame
from oss.src.core.sessions.records.streaming import publish_live_frame
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


async def test_publish_frame_applies_measured_maxlen():
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
    with patch(
        "oss.src.core.sessions.records.streaming._get_redis", return_value=redis
    ):
        assert await publish_live_frame(project_id=uuid4(), frame=frame)

    assert redis.xadd.await_args.kwargs["maxlen"] == 100_000
    assert redis.xadd.await_args.kwargs["maxlen"] == env.sessions.live_stream_maxlen
    assert redis.xadd.await_args.kwargs["approximate"] is True


async def test_records_worker_skips_temporary_frames():
    project_id = uuid4()
    service = AsyncMock()
    worker = RecordsWorker(
        service=service,
        redis_client=AsyncMock(),
        stream_name="streams:records",
        consumer_group="worker-records",
    )
    raw = {
        "organization_id": None,
        "project_id": str(project_id),
        "kind": "frame",
        "frame": _frame().model_dump(mode="json", exclude_none=True),
    }

    appended, processed = await worker.process_batch(
        [(b"1-0", {b"data": zlib.compress(dumps(raw))})]
    )

    assert appended == 0
    assert processed == [b"1-0"]
    service.append_many.assert_not_awaited()
