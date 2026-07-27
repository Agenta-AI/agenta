"""M3 live relay — SSE watch endpoint (T2).

`GET /sessions/streams/watch` bridges one durable-Redis pubsub subscription into
`text/event-stream` frames: known payloads become named SSE events, idle windows
become `: heartbeat` comments, and closing the generator (client disconnect)
tears the subscription down. RBAC mirrors `query_records` (VIEW_SESSIONS).
"""

import asyncio
import json
from unittest.mock import AsyncMock, patch
from uuid import uuid4

import pytest
from fastapi import FastAPI, HTTPException, Request

from oss.src.apis.fastapi.sessions.router import SessionStreamsRouter
from oss.src.apis.fastapi.sessions.watch import (
    HEARTBEAT_FRAME,
    format_watch_frame,
    watch_event_stream,
)
from oss.src.dbs.redis.sessions.contract import watch_channel
from oss.src.dbs.redis.sessions.watch import SessionsWatchPublisher


class _FakePubSub:
    """Scripted pubsub: returns queued messages, then None (idle) forever."""

    def __init__(self, messages):
        self.messages = list(messages)
        self.subscribed: list[str] = []
        self.unsubscribed: list[str] = []
        self.closed = False

    async def subscribe(self, channel):
        self.subscribed.append(channel)

    async def get_message(self, *, ignore_subscribe_messages=False, timeout=None):
        if self.messages:
            return self.messages.pop(0)
        return None

    async def unsubscribe(self, channel):
        self.unsubscribed.append(channel)

    async def aclose(self):
        self.closed = True


def _msg(payload: dict) -> dict:
    return {"type": "message", "data": json.dumps(payload).encode()}


@pytest.mark.asyncio
async def test_stream_yields_event_frames_then_heartbeats():
    pubsub = _FakePubSub(
        [
            _msg({"type": "records-changed", "session_id": "s1"}),
            _msg({"type": "lifecycle", "session_id": "s1", "state": "running"}),
            _msg({"type": "interaction", "session_id": "s1", "status": "pending"}),
        ]
    )
    stream = watch_event_stream(
        channel="watch:p:session:s1",
        pubsub_factory=lambda: pubsub,
        heartbeat_seconds=0.01,
    )

    frames = []
    async for frame in stream:
        frames.append(frame)
        if len(frames) == 4:
            await stream.aclose()
            break

    assert frames[0].startswith("event: records-changed\n")
    assert json.loads(frames[0].split("data: ")[1]) == {
        "type": "records-changed",
        "session_id": "s1",
    }
    assert frames[1].startswith("event: lifecycle\n")
    assert '"state": "running"' in frames[1]
    assert frames[2].startswith("event: interaction\n")
    # Queue drained -> the idle path emits keep-alive comments.
    assert frames[3] == HEARTBEAT_FRAME
    assert pubsub.subscribed == ["watch:p:session:s1"]


@pytest.mark.asyncio
async def test_stream_cleans_up_subscription_on_close():
    pubsub = _FakePubSub([])
    stream = watch_event_stream(
        channel="watch:p:session:s1",
        pubsub_factory=lambda: pubsub,
        heartbeat_seconds=0.01,
    )
    # Take one heartbeat, then simulate the client disconnecting.
    frame = await stream.__anext__()
    assert frame == HEARTBEAT_FRAME
    await stream.aclose()

    assert pubsub.unsubscribed == ["watch:p:session:s1"]
    assert pubsub.closed is True


@pytest.mark.asyncio
async def test_stream_skips_malformed_and_unknown_payloads():
    pubsub = _FakePubSub(
        [
            {"type": "message", "data": b"not json"},
            _msg({"type": "unknown-event", "session_id": "s1"}),
            {"type": "subscribe", "data": 1},
            _msg({"type": "records-changed", "session_id": "s1"}),
        ]
    )
    stream = watch_event_stream(
        channel="watch:p:session:s1",
        pubsub_factory=lambda: pubsub,
        heartbeat_seconds=0.01,
    )
    frame = await stream.__anext__()
    await stream.aclose()
    # The three junk messages are dropped; the first frame is the real event.
    assert frame.startswith("event: records-changed\n")


def test_format_watch_frame_rejects_non_dict_and_unknown_type():
    assert format_watch_frame(b"[1, 2]") is None
    assert format_watch_frame(b"\xff\xfe") is None
    assert format_watch_frame(json.dumps({"type": "nope"}).encode()) is None
    frame = format_watch_frame(
        json.dumps({"type": "lifecycle", "session_id": "s", "state": "ended"}).encode()
    )
    assert frame == (
        'event: lifecycle\ndata: {"type": "lifecycle", "session_id": "s", "state": "ended"}\n\n'
    )


@pytest.mark.asyncio
async def test_stream_delivers_publisher_events_end_to_end():
    """Publisher (T1) -> fakeredis pub/sub -> SSE generator (T2), one plane."""
    import fakeredis

    redis = fakeredis.FakeAsyncRedis()
    project_id = str(uuid4())
    channel = watch_channel(project_id, "sess-e2e")

    stream = watch_event_stream(
        channel=channel,
        pubsub_factory=lambda: redis.pubsub(),
        heartbeat_seconds=0.05,
    )
    # First frame is a heartbeat — proves the subscription is live before publishing.
    assert await stream.__anext__() == HEARTBEAT_FRAME

    publisher = SessionsWatchPublisher(redis_client=redis)
    await publisher.records_changed(project_id=project_id, session_id="sess-e2e")

    async def _next_event_frame():
        while True:
            frame = await stream.__anext__()
            if frame != HEARTBEAT_FRAME:
                return frame

    frame = await asyncio.wait_for(_next_event_frame(), timeout=2)
    await stream.aclose()
    assert frame.startswith("event: records-changed\n")
    assert json.loads(frame.split("data: ")[1])["session_id"] == "sess-e2e"


def _make_authed_request(app: FastAPI, project_id, user_id) -> Request:
    scope = {
        "type": "http",
        "method": "GET",
        "path": "/sessions/streams/watch",
        "headers": [],
        "app": app,
    }
    request = Request(scope)
    request.state.project_id = str(project_id)
    request.state.user_id = str(user_id)
    return request


def _router() -> SessionStreamsRouter:
    return SessionStreamsRouter(
        service=AsyncMock(),
        interactions_service=AsyncMock(),
    )


@pytest.mark.asyncio
async def test_watch_endpoint_rejects_without_view_sessions():
    router = _router()
    request = _make_authed_request(FastAPI(), uuid4(), uuid4())

    with patch(
        "oss.src.apis.fastapi.sessions.router.check_action_access",
        new_callable=AsyncMock,
        return_value=False,
    ):
        with pytest.raises(HTTPException) as exc_info:
            await router.watch_session_stream(request=request, session_id="sess-1")

    assert exc_info.value.status_code == 403


@pytest.mark.asyncio
async def test_watch_endpoint_rejects_invalid_session_id():
    router = _router()
    request = _make_authed_request(FastAPI(), uuid4(), uuid4())

    with pytest.raises(HTTPException) as exc_info:
        await router.watch_session_stream(request=request, session_id="bad/../id")

    assert exc_info.value.status_code == 400


@pytest.mark.asyncio
async def test_watch_endpoint_returns_event_stream_response():
    router = _router()
    request = _make_authed_request(FastAPI(), uuid4(), uuid4())

    with patch(
        "oss.src.apis.fastapi.sessions.router.check_action_access",
        new_callable=AsyncMock,
        return_value=True,
    ):
        response = await router.watch_session_stream(request=request, session_id="s-1")

    assert response.media_type == "text/event-stream"
    assert response.headers["cache-control"] == "no-cache"
    assert response.headers["x-accel-buffering"] == "no"
