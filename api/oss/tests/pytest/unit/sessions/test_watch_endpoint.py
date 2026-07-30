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
    retry_frame,
    watch_event_stream,
)
from oss.src.dbs.redis.sessions.contract import watch_channel
from oss.src.dbs.redis.sessions.watch import SessionsWatchPublisher
from oss.src.utils.env import env


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
        retry_milliseconds=5000,
    )

    frames = []
    async for frame in stream:
        frames.append(frame)
        if len(frames) == 5:
            await stream.aclose()
            break

    # The preamble pins the client's built-in auto-reconnect delay.
    assert frames[0] == retry_frame(5000)
    assert frames[1].startswith("event: records-changed\n")
    assert json.loads(frames[1].split("data: ")[1]) == {
        "type": "records-changed",
        "session_id": "s1",
    }
    assert frames[2].startswith("event: lifecycle\n")
    assert '"state": "running"' in frames[2]
    assert frames[3].startswith("event: interaction\n")
    # Queue drained -> the idle path emits keep-alive comments.
    assert frames[4] == HEARTBEAT_FRAME
    assert pubsub.subscribed == ["watch:p:session:s1"]


@pytest.mark.asyncio
async def test_stream_cleans_up_subscription_on_close():
    pubsub = _FakePubSub([])
    stream = watch_event_stream(
        channel="watch:p:session:s1",
        pubsub_factory=lambda: pubsub,
        heartbeat_seconds=0.01,
        retry_milliseconds=5000,
    )
    # Take the preamble + one heartbeat, then simulate the client disconnecting.
    assert await stream.__anext__() == retry_frame(5000)
    assert await stream.__anext__() == HEARTBEAT_FRAME
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
        retry_milliseconds=5000,
    )
    assert await stream.__anext__() == retry_frame(5000)
    frame = await stream.__anext__()
    await stream.aclose()
    # The three junk messages are dropped; the first frame is the real event.
    assert frame.startswith("event: records-changed\n")


@pytest.mark.asyncio
async def test_stream_preamble_pins_the_clients_reconnect_delay():
    """Without a `retry:` field the browser's auto-reconnect delay is
    implementation-defined — an API restart then reconnect-storms us."""
    pubsub = _FakePubSub([])
    stream = watch_event_stream(
        channel="watch:p:session:s1",
        pubsub_factory=lambda: pubsub,
        heartbeat_seconds=0.01,
        retry_milliseconds=7500,
    )
    first = await stream.__anext__()
    await stream.aclose()

    assert first == "retry: 7500\n\n"
    # The preamble follows SUBSCRIBE, so no event can land in an unsubscribed
    # window between the client's `open` and the first frame.
    assert pubsub.subscribed == ["watch:p:session:s1"]


def test_retry_frame_is_a_field_only_sse_frame():
    frame = retry_frame(5000)
    assert frame == "retry: 5000\n\n"
    # A field-only frame sets the reconnect time without dispatching an event.
    assert "data:" not in frame and "event:" not in frame


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
        retry_milliseconds=5000,
    )
    # Preamble, then a heartbeat — proves the subscription is live before publishing.
    assert await stream.__anext__() == retry_frame(5000)
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


@pytest.mark.asyncio
async def test_watch_endpoint_streams_the_configured_retry_preamble():
    """The env-configured reconnect delay actually reaches the wire."""
    router = _router()
    request = _make_authed_request(FastAPI(), uuid4(), uuid4())
    pubsub = _FakePubSub([])

    with (
        patch(
            "oss.src.apis.fastapi.sessions.router.check_action_access",
            new_callable=AsyncMock,
            return_value=True,
        ),
        patch(
            "oss.src.apis.fastapi.sessions.router.get_streams_engine"
        ) as streams_engine,
        patch.object(env.sessions, "watch_retry_milliseconds", 9000),
    ):
        streams_engine.return_value.get_redis.return_value.pubsub.return_value = pubsub
        response = await router.watch_session_stream(request=request, session_id="s-1")
        first = await response.body_iterator.__anext__()
        await response.body_iterator.aclose()

    assert first == "retry: 9000\n\n"
