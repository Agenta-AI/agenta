"""Watch streams must not starve span ingest and event publishing of Redis connections.

Every watch SSE stream holds one pub/sub connection for as long as its client stays
connected. They used to come from the same pool as span and event XADD. With that
pool full of open streams (redis-py 8 caps a pool at 100 connections), every span
upload failed with `MaxConnectionsError: Too many connections`.

These tests run the real routes and publishers against an in-memory Redis (fakeredis
keeps redis-py's own connection pool, so pool limits behave as in production).
"""

from datetime import datetime, timedelta, timezone
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch
from uuid import UUID, uuid4

import anyio
import fakeredis
import pytest
from fastapi import FastAPI, Request

from oss.src.apis.fastapi.otlp.router import OTLPRouter
from oss.src.apis.fastapi.sessions.router import SessionStreamsRouter
from oss.src.apis.fastapi.sessions.watch import ready_frame, retry_frame
from oss.src.core.events.dtos import Event
from oss.src.core.events.streaming import publish_event
from oss.src.core.events.types import EventType, RequestType
from oss.src.core.tracing.dtos import OTelFlatSpan
from oss.src.core.tracing.streaming import publish_spans
from oss.src.dbs.redis.shared import engine as engine_module
from oss.src.dbs.redis.shared.engine import StreamsEngine
from oss.src.dbs.redis.sessions.contract import watch_channel
from oss.tests.pytest.utils.sharing import NoopRunAdmission

PROJECT_ID = UUID("11111111-1111-1111-1111-111111111111")
ORGANIZATION_ID = UUID("22222222-2222-2222-2222-222222222222")
USER_ID = UUID("33333333-3333-3333-3333-333333333333")


@pytest.fixture
async def streams(monkeypatch):
    """The process-wide streams engine, backed by one in-memory Redis server."""
    server = fakeredis.FakeServer()
    from_url = fakeredis.FakeAsyncRedis.from_url

    class _FakeRedis(fakeredis.FakeAsyncRedis):
        @classmethod
        def from_url(cls, url, **kwargs):
            client = from_url(url, **kwargs)
            client.connection_pool.connection_kwargs["server"] = server
            return client

    monkeypatch.setattr("redis.asyncio.Redis", _FakeRedis)
    # fakeredis answers the PING health check in a way redis-py rejects.
    monkeypatch.setattr(engine_module, "STREAMS_HEALTH_CHECK_INTERVAL", 0)
    monkeypatch.setattr(
        engine_module,
        "env",
        SimpleNamespace(redis=SimpleNamespace(uri_durable="redis://durable:6381/0")),
    )
    engine = StreamsEngine()
    monkeypatch.setattr(engine_module, "_streams_engine", engine)
    try:
        yield engine
    finally:
        await engine.close()


def _router() -> SessionStreamsRouter:
    return SessionStreamsRouter(
        service=AsyncMock(),
        interactions_service=AsyncMock(),
        run_admission=NoopRunAdmission(),
    )


def _request() -> Request:
    request = Request(
        {
            "type": "http",
            "method": "GET",
            "path": "/sessions/streams/watch",
            "headers": [],
            "app": FastAPI(),
        }
    )
    request.state.project_id = str(PROJECT_ID)
    request.state.user_id = str(USER_ID)
    return request


async def _open_watch(router: SessionStreamsRouter, session_id: str):
    """Open one session watch stream and read it until its subscription is live."""
    response = await router.watch_session_stream(
        request=_request(), session_id=session_id
    )
    frames = [
        await response.body_iterator.__anext__(),
        await response.body_iterator.__anext__(),
    ]
    return response, frames


def _span() -> OTelFlatSpan:
    start = datetime(2026, 1, 1, tzinfo=timezone.utc)
    return OTelFlatSpan(
        trace_id="0123456789abcdef0123456789abcdef",
        span_id="0123456789abcdef",
        span_name="root",
        start_time=start,
        end_time=start + timedelta(seconds=1),
    )


async def _upload_span(monkeypatch) -> int:
    """POST one span through the OTLP route; the tracing service queues it on Redis."""

    async def _ingest_span_dtos(*, organization_id, project_id, user_id, span_dtos):
        await publish_spans(
            organization_id=organization_id,
            project_id=project_id,
            user_id=user_id,
            span_dtos=span_dtos,
        )

    async def _allowed(*args, **kwargs):
        return True

    monkeypatch.setattr(
        "oss.src.apis.fastapi.otlp.router.parse_otlp_stream", lambda _body: ["span"]
    )
    monkeypatch.setattr(
        "oss.src.apis.fastapi.otlp.router.parse_from_otel_span_dto",
        lambda _span_payload: _span(),
    )
    monkeypatch.setattr(
        "oss.src.apis.fastapi.otlp.router.check_action_access", _allowed, raising=False
    )
    tracing_service = MagicMock()
    tracing_service.ingest_span_dtos = _ingest_span_dtos
    request = SimpleNamespace(
        state=SimpleNamespace(
            project_id=str(PROJECT_ID),
            organization_id=str(ORGANIZATION_ID),
            user_id=str(USER_ID),
        ),
        body=AsyncMock(return_value=b"otlp"),
    )

    response = await OTLPRouter(tracing_service=tracing_service).otlp_ingest(request)
    return response.status_code


async def _publish_event() -> bool:
    return await publish_event(
        organization_id=ORGANIZATION_ID,
        project_id=PROJECT_ID,
        event=Event(
            request_id=uuid4(),
            event_id=uuid4(),
            request_type=RequestType.UNKNOWN,
            event_type=EventType.TRACES_FETCHED,
            timestamp=datetime.now(timezone.utc),
        ),
    )


@pytest.mark.asyncio
async def test_span_upload_succeeds_while_watch_streams_hold_a_full_pool(
    streams, monkeypatch
):
    router = _router()
    # As many open streams as the ingest pool has connections: before the fix they
    # took all of them and the upload below failed with "Too many connections".
    open_streams = streams.get_redis().connection_pool.max_connections
    responses = []
    with patch(
        "oss.src.apis.fastapi.sessions.router.allow_resource",
        new_callable=AsyncMock,
        return_value=True,
    ):
        for index in range(open_streams):
            response, frames = await _open_watch(router, f"s-{index}")
            assert frames[1] == ready_frame()
            responses.append(response)

    try:
        subscriber_pool = streams.get_subscriber_redis().connection_pool
        assert len(subscriber_pool._in_use_connections) == open_streams

        assert await _upload_span(monkeypatch) == 200
        assert await streams.get_redis().xlen("streams:spans") == 1
        assert await _publish_event() is True
        assert await streams.get_redis().xlen("streams:events") == 1
    finally:
        for response in responses:
            await response.body_iterator.aclose()


@pytest.mark.asyncio
async def test_stream_past_the_subscriber_cap_ends_with_a_retry_and_ingest_works(
    streams, monkeypatch
):
    monkeypatch.setattr(engine_module, "STREAMS_SUBSCRIBER_MAX_CONNECTIONS", 3)
    router = _router()
    responses = []
    with patch(
        "oss.src.apis.fastapi.sessions.router.allow_resource",
        new_callable=AsyncMock,
        return_value=True,
    ):
        for index in range(3):
            response, _ = await _open_watch(router, f"s-{index}")
            responses.append(response)

        refused = await router.watch_session_stream(
            request=_request(), session_id="s-over-cap"
        )
        with anyio.fail_after(5):
            frames = [frame async for frame in refused.body_iterator]

    try:
        # The client gets the reconnect delay and nothing else, so it retries later.
        assert frames == [retry_frame(5000)]
        assert await _upload_span(monkeypatch) == 200
    finally:
        for response in responses:
            await response.body_iterator.aclose()


@pytest.mark.asyncio
async def test_client_disconnect_releases_the_subscription(streams):
    """Serve the real StreamingResponse as ASGI and send `http.disconnect` once the
    stream is live, as uvicorn does when the client goes away."""
    router = _router()
    with patch(
        "oss.src.apis.fastapi.sessions.router.allow_resource",
        new_callable=AsyncMock,
        return_value=True,
    ):
        response = await router.watch_session_stream(
            request=_request(), session_id="s-1"
        )

    channel = watch_channel(str(PROJECT_ID), "s-1").encode()
    subscriber_pool = streams.get_subscriber_redis().connection_pool
    live = anyio.Event()
    subscribers_while_live = []

    async def send(message):
        if message["type"] == "http.response.body" and ready_frame().encode() in (
            message.get("body") or b""
        ):
            subscribers_while_live.extend(
                await streams.get_redis().pubsub_numsub(channel)
            )
            live.set()

    async def receive():
        await live.wait()
        return {"type": "http.disconnect"}

    scope = {"type": "http", "asgi": {"spec_version": "2.3"}}
    with anyio.fail_after(5):
        await response(scope, receive, send)

    assert subscribers_while_live == [(channel, 1)]
    assert await streams.get_redis().pubsub_numsub(channel) == [(channel, 0)]
    assert len(subscriber_pool._in_use_connections) == 0
