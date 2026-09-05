import asyncio
import json
import zlib
from datetime import datetime, timedelta, timezone
from unittest.mock import AsyncMock, patch
from uuid import uuid4

import pytest
from fastapi import FastAPI, HTTPException, Request
from orjson import dumps

from oss.src.apis.fastapi.sessions.live_events import live_event_stream
from oss.src.apis.fastapi.sessions.router import SessionStreamsRouter
from oss.src.core.sessions.records.streaming import LIVE_FRAME_STREAM_NAME
from oss.src.tasks.asyncio.sessions.live_relay_worker import LiveRelayWorker
from oss.src.utils.env import env


class FakePubSub:
    def __init__(self, messages):
        self.messages = list(messages)
        self.subscribed = AsyncMock()
        self.unsubscribed = AsyncMock()
        self.closed = AsyncMock()

    async def subscribe(self, channel):
        await self.subscribed(channel)

    async def get_message(self, **_kwargs):
        await asyncio.sleep(0)
        if self.messages:
            return self.messages.pop(0)
        await asyncio.sleep(0.01)
        return None

    async def unsubscribe(self, channel):
        await self.unsubscribed(channel)

    async def aclose(self):
        await self.closed()


def _frame(index: int = 0):
    return {
        "version": 1,
        "kind": "frame",
        "session_id": "session-1",
        "execution_id": "execution-1",
        "frame_or_event_id": f"execution-1:{index}",
        "frame_index": index,
        "entity_id": "message-1",
        "type": "text-delta",
        "payload": {"id": "message-1", "delta": "hello"},
        "created_at": datetime.now(timezone.utc).isoformat(),
    }


async def test_rechecks_authorization_and_closes_revoked_reader():
    pubsub = FakePubSub([])
    checks = 0

    async def authorize():
        nonlocal checks
        checks += 1
        return False

    stream = live_event_stream(
        channel="events:project-1:session:session-1",
        pubsub_factory=lambda: pubsub,
        authorization_check=authorize,
        authorization_recheck_seconds=0.001,
        heartbeat_seconds=60,
        retry_milliseconds=5000,
        buffer_limit=4,
    )

    assert (await anext(stream)).startswith("retry: 5000")
    assert (await anext(stream)).startswith("event: ready")
    terminal = await anext(stream)
    assert terminal.startswith("event: relay-close")
    assert (
        json.loads(terminal.split("data: ", 1)[1])["reason"] == "authorization_revoked"
    )
    assert checks == 1


async def test_slow_reader_gets_terminal_close_frame():
    messages = [{"type": "message", "data": dumps(_frame(index))} for index in range(3)]
    pubsub = FakePubSub(messages)
    stream = live_event_stream(
        channel="events:project-1:session:session-1",
        pubsub_factory=lambda: pubsub,
        authorization_check=AsyncMock(return_value=True),
        authorization_recheck_seconds=60,
        heartbeat_seconds=60,
        retry_milliseconds=5000,
        buffer_limit=1,
    )

    assert (await anext(stream)).startswith("retry:")
    assert (await anext(stream)).startswith("event: ready")
    await asyncio.sleep(0.02)
    terminal = await anext(stream)
    assert terminal.startswith("event: relay-close")
    assert json.loads(terminal.split("data: ", 1)[1])["reason"] == "slow_reader"


async def test_relay_worker_publishes_and_deletes_frames():
    project_id = uuid4()
    redis = AsyncMock()
    worker = LiveRelayWorker(
        redis_client=redis,
        stream_name=LIVE_FRAME_STREAM_NAME,
        consumer_group="worker-session-live-relay",
    )
    frame_message = {
        "organization_id": None,
        "project_id": str(project_id),
        "kind": "frame",
        "frame": _frame(),
    }
    batch = [
        (b"1-0", {b"data": zlib.compress(dumps(frame_message))}),
    ]

    published, processed = await worker.process_batch(batch)
    await worker.ack_and_delete(processed)

    assert published == 1
    assert processed == [b"1-0"]
    redis.publish.assert_awaited_once()
    redis.xack.assert_awaited_once_with(
        LIVE_FRAME_STREAM_NAME, "worker-session-live-relay", b"1-0"
    )
    redis.xdel.assert_awaited_once_with(LIVE_FRAME_STREAM_NAME, b"1-0")


async def test_relay_worker_discards_frames_older_than_900_seconds():
    project_id = uuid4()
    redis = AsyncMock()
    worker = LiveRelayWorker(
        redis_client=redis,
        stream_name=LIVE_FRAME_STREAM_NAME,
        consumer_group="worker-session-live-relay",
    )
    expired = _frame(0)
    expired["created_at"] = (
        datetime.now(timezone.utc) - timedelta(seconds=901)
    ).isoformat()
    fresh = _frame(1)
    batch = [
        (
            b"1-0",
            {
                b"data": zlib.compress(
                    dumps(
                        {
                            "organization_id": None,
                            "project_id": str(project_id),
                            "kind": "frame",
                            "frame": expired,
                        }
                    )
                )
            },
        ),
        (
            b"2-0",
            {
                b"data": zlib.compress(
                    dumps(
                        {
                            "organization_id": None,
                            "project_id": str(project_id),
                            "kind": "frame",
                            "frame": fresh,
                        }
                    )
                )
            },
        ),
    ]

    with patch.object(env.sessions, "live_frame_max_age_seconds", 900):
        published, processed = await worker.process_batch(batch)

    assert published == 1
    assert processed == [b"1-0", b"2-0"]
    redis.publish.assert_awaited_once()


async def test_events_route_is_hidden_when_shared_reader_is_off():
    router = SessionStreamsRouter(
        service=AsyncMock(),
        interactions_service=AsyncMock(),
    )
    request = Request(
        {
            "type": "http",
            "method": "GET",
            "path": "/sessions/session-1/events",
            "headers": [],
            "app": FastAPI(),
        }
    )
    request.state.project_id = str(uuid4())
    request.state.user_id = str(uuid4())

    with patch.object(env.sessions, "shared_reader", False):
        with pytest.raises(HTTPException) as exc_info:
            await router.session_events(request=request, session_id="session-1")

    assert exc_info.value.status_code == 404


async def test_events_route_disables_authenticated_response_storage():
    router = SessionStreamsRouter(
        service=AsyncMock(),
        interactions_service=AsyncMock(),
    )
    request = Request(
        {
            "type": "http",
            "method": "GET",
            "path": "/sessions/session-1/events",
            "headers": [],
            "app": FastAPI(),
        }
    )
    request.state.project_id = str(uuid4())
    request.state.user_id = str(uuid4())

    with (
        patch.object(env.sessions, "shared_reader", True),
        patch(
            "oss.src.apis.fastapi.sessions.router.check_action_access",
            new_callable=AsyncMock,
            return_value=True,
        ),
    ):
        response = await router.session_events(request=request, session_id="session-1")

    assert response.headers["cache-control"] == "no-store"
    await response.body_iterator.aclose()
