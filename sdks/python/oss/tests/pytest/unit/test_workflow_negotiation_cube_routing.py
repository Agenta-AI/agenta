"""
ROUTING — the full negotiation CUBE over the real `/invoke` route.

This is the systematic extension of test_workflow_negotiation_routing.py (which
covered shape x Accept on `handle_invoke_success` directly) and
test_invoke_route_aggregation_routing.py (which covered Accept->flags aggregation).
Here we drive the REAL `route()`-mounted `/invoke` via a Starlette TestClient and
sweep all three negotiation axes against all four handler shapes:

    shape     ∈ {sync-fn, async-fn, sync-gen, async-gen}     (handler return type)
    transport ∈ {none, application/json, text/event-stream, application/x-ndjson}   (Accept)
    format    ∈ {agenta (default), vercel}                   (x-ag-messages-format)
    transcript ∈ {unset/last, full}                       (x-ag-messages-transcript)

It asserts the RESPONSE (status, media type, body/stream framing, vercel projection,
transcript trim). It does NOT assert traces — the span tree is invariant across these
axes (see otel-instrument-test-plan.md §3), so trace structure/content is asserted
once-per-shape programmatically (integration/observability) and over a live backend
(acceptance/observability/test_workflow_instrument_routed.py).

Offline: TestClient + a fake-auth middleware + the offline tracing mock, so
`wf.invoke` runs without `ag.init()` or a backend (mirrors the sibling routing tests).
"""

from contextlib import contextmanager

import pytest
from unittest.mock import MagicMock, patch

from fastapi import FastAPI
from fastapi.testclient import TestClient

from agenta.sdk.decorators.routing import route


# Offline runtime (tracing + singleton not under test)
@contextmanager
def _offline_tracing():
    with (
        patch("agenta.sdk.decorators.tracing.ag") as mock_ag,
        patch("agenta.sdk.decorators.running.ag") as mock_run_ag,
    ):
        span = MagicMock()
        span.is_recording.return_value = False
        span.get_span_context.return_value = MagicMock(trace_id=0, span_id=0)
        mock_ag.tracing = MagicMock()
        mock_ag.tracing.get_current_span.return_value = span
        mock_ag.tracing.redact = None
        tracer = MagicMock()
        tracer.start_as_current_span.return_value.__enter__ = MagicMock(
            return_value=span
        )
        tracer.start_as_current_span.return_value.__exit__ = MagicMock(
            return_value=None
        )
        mock_ag.tracer = tracer
        mock_run_ag.DEFAULT_AGENTA_SINGLETON_INSTANCE = MagicMock()
        mock_run_ag.DEFAULT_AGENTA_SINGLETON_INSTANCE.api_key = None
        yield


# Handlers mirror the per-layer shapes /invoke carries (see services agent app.py):
# batch returns the agent {messages:[...]} envelope, stream yields agenta events {type, data}.
from agenta.sdk.workflows.handlers import _mock_messages, _mock_events  # noqa: E402


def _batch_envelope(value: str):
    return _mock_messages(text=f"reply:{value}")


async def _event_stream(value: str):
    async for ev in _mock_events(text=f"reply {value}"):
        yield ev


def _build_app(shape: str) -> FastAPI:
    app = FastAPI()

    @app.middleware("http")
    async def _fake_auth(request, call_next):
        request.state.auth = {}
        return await call_next(request)

    if shape == "sync-fn":

        @route("/", app=app)
        def wf(value: str = "x"):
            return _batch_envelope(value)

    elif shape == "async-fn":

        @route("/", app=app)
        async def wf(value: str = "x"):
            return _batch_envelope(value)

    elif shape == "sync-gen":

        @route("/", app=app)
        def wf(value: str = "x"):
            # sync gen can't drive the async mock, so emit the canonical events directly
            yield {"type": "message_start", "data": {"id": "msg-1"}}
            yield {
                "type": "message_delta",
                "data": {"id": "msg-1", "delta": f"reply {value}"},
            }
            yield {"type": "message_end", "data": {"id": "msg-1"}}
            yield {"type": "done", "data": {"stopReason": "stop"}}

    elif shape == "async-gen":

        @route("/", app=app)
        async def wf(value: str = "x"):
            async for ev in _event_stream(value):
                yield ev

    else:  # pragma: no cover
        raise ValueError(shape)

    return app


def _client(shape: str) -> TestClient:
    return TestClient(_build_app(shape))


def _post(
    client,
    *,
    accept=None,
    fmt=None,
    transcript=None,
    control=None,
    embeds=None,
    flags=None,
):
    headers = {}
    if accept is not None:
        headers["accept"] = accept
    if fmt is not None:
        headers["x-ag-messages-format"] = fmt
    if transcript is not None:
        headers["x-ag-messages-transcript"] = transcript
    if control is not None:
        headers["x-ag-session-control"] = control
    if embeds is not None:
        headers["x-ag-workflow-embeds"] = embeds
    body = {"data": {"inputs": {"value": "x"}}}
    if flags is not None:
        body["flags"] = flags
    return client.post("/invoke", json=body, headers=headers)


SHAPES = ["sync-fn", "async-fn", "sync-gen", "async-gen"]
BATCH_SHAPES = ["sync-fn", "async-fn"]
STREAM_SHAPES = ["sync-gen", "async-gen"]


# AXIS 1 — transport (Accept) x shape
@pytest.mark.parametrize("shape", BATCH_SHAPES)
@pytest.mark.parametrize("accept", [None, "application/json"])
def test_batch_shape_batch_accept_is_json(shape, accept):
    with _offline_tracing():
        resp = _post(_client(shape), accept=accept)
    assert resp.status_code == 200
    assert "application/json" in resp.headers["content-type"]
    msgs = resp.json()["data"]["outputs"]["messages"]
    assert msgs[-1]["role"] == "assistant"
    assert msgs[-1]["content"] == "reply:x"


@pytest.mark.parametrize("shape", BATCH_SHAPES)
@pytest.mark.parametrize("accept", ["text/event-stream", "application/x-ndjson"])
def test_batch_shape_stream_accept_is_406(shape, accept):
    # pure batch handler can't satisfy a stream Accept
    with _offline_tracing():
        resp = _post(_client(shape), accept=accept)
    assert resp.status_code == 406


@pytest.mark.parametrize("shape", STREAM_SHAPES)
def test_stream_shape_no_accept_is_natural_stream(shape):
    # no Accept -> serves the handler's natural stream shape as ndjson, no aggregation
    with _offline_tracing():
        resp = _post(_client(shape), accept=None)
    assert resp.status_code == 200
    assert "application/x-ndjson" in resp.headers["content-type"]


@pytest.mark.parametrize("shape", STREAM_SHAPES)
def test_stream_shape_no_accept_with_stream_flag_is_ndjson(shape):
    # explicit stream flag restores streaming with no Accept header
    with _offline_tracing():
        resp = _post(_client(shape), accept=None, flags={"stream": True})
    assert resp.status_code == 200
    assert "application/x-ndjson" in resp.headers["content-type"]


@pytest.mark.parametrize("shape", STREAM_SHAPES)
def test_stream_shape_sse_accept_is_sse(shape):
    with _offline_tracing():
        resp = _post(_client(shape), accept="text/event-stream")
    assert resp.status_code == 200
    assert "text/event-stream" in resp.headers["content-type"]


@pytest.mark.parametrize("shape", STREAM_SHAPES)
def test_stream_shape_ndjson_accept_is_ndjson(shape):
    with _offline_tracing():
        resp = _post(_client(shape), accept="application/x-ndjson")
    assert resp.status_code == 200
    assert "application/x-ndjson" in resp.headers["content-type"]


@pytest.mark.parametrize("shape", STREAM_SHAPES)
def test_stream_shape_json_accept_is_406(shape):
    with _offline_tracing():
        resp = _post(_client(shape), accept="application/json")
    assert resp.status_code == 406


# AXIS 3 — transcript x shape (batch direction; full vs last)
@pytest.mark.parametrize("shape", STREAM_SHAPES)
def test_stream_shape_json_accept_with_transcript_header_is_406(shape):
    # transcript header can't rescue a batch Accept against a stream-only handler
    with _offline_tracing():
        resp = _post(_client(shape), accept="application/json", transcript="last")
    assert resp.status_code == 406


@pytest.mark.parametrize("shape", BATCH_SHAPES)
def test_batch_envelope_history_trims_messages_list(shape):
    # trim trims the messages list in place; here full and last are both length 1
    with _offline_tracing():
        full = _post(_client(shape), accept="application/json", transcript="full")
        last = _post(_client(shape), accept="application/json", transcript="last")
    assert full.status_code == last.status_code == 200
    full_msgs = full.json()["data"]["outputs"]["messages"]
    last_msgs = last.json()["data"]["outputs"]["messages"]
    assert len(full_msgs) == 1 and len(last_msgs) == 1
    assert last_msgs[0]["content"] == "reply:x"


# AXIS 2 — format (agenta vs vercel) x shape
@pytest.mark.parametrize("shape", BATCH_SHAPES)
def test_batch_vercel_projects_messages_and_sets_headers(shape):
    with _offline_tracing():
        resp = _post(_client(shape), accept="application/json", fmt="vercel")
    assert resp.status_code == 200
    assert resp.headers.get("x-ag-messages-format") == "vercel"
    messages = resp.json()["data"]["outputs"]["messages"]
    assert isinstance(messages, list) and len(messages) >= 1
    assert any("parts" in m for m in messages), "expected projected UIMessage parts"


@pytest.mark.parametrize("shape", BATCH_SHAPES)
def test_batch_agenta_format_is_passthrough(shape):
    with _offline_tracing():
        resp = _post(_client(shape), accept="application/json", fmt="agenta")
    assert resp.status_code == 200
    messages = resp.json()["data"]["outputs"]["messages"]
    assert all("content" in m for m in messages)


@pytest.mark.parametrize("shape", STREAM_SHAPES)
def test_stream_vercel_is_sse_with_vercel_headers(shape):
    with _offline_tracing():
        resp = _post(_client(shape), accept="text/event-stream", fmt="vercel")
    assert resp.status_code == 200
    assert "text/event-stream" in resp.headers["content-type"]
    assert resp.headers.get("x-ag-messages-format") == "vercel"
    assert "[DONE]" in resp.text


@pytest.mark.parametrize("shape", STREAM_SHAPES)
def test_stream_agenta_sse_is_plain_sse(shape):
    with _offline_tracing():
        resp = _post(_client(shape), accept="text/event-stream", fmt="agenta")
    assert resp.status_code == 200
    assert "text/event-stream" in resp.headers["content-type"]
    assert "data:" in resp.text


# AXIS 4 — control (x-ag-session-control: force) x shape
# these synthetic shapes take no `request` param, so force is inert for them either way
@pytest.mark.parametrize("shape", BATCH_SHAPES)
def test_batch_shape_force_header_is_inert(shape):
    with _offline_tracing():
        resp = _post(_client(shape), accept="application/json", control="force")
    assert resp.status_code == 200
    assert resp.json()["data"]["outputs"]["messages"][-1]["content"] == "reply:x"


@pytest.mark.parametrize("shape", BATCH_SHAPES)
def test_batch_shape_force_body_flag_is_inert(shape):
    with _offline_tracing():
        resp = _post(_client(shape), accept="application/json", flags={"force": True})
    assert resp.status_code == 200
    assert resp.json()["data"]["outputs"]["messages"][-1]["content"] == "reply:x"


@pytest.mark.parametrize("shape", STREAM_SHAPES)
def test_stream_shape_force_header_is_inert(shape):
    with _offline_tracing():
        resp = _post(_client(shape), accept="text/event-stream", control="force")
    assert resp.status_code == 200
    assert "text/event-stream" in resp.headers["content-type"]


@pytest.mark.parametrize("shape", STREAM_SHAPES)
def test_stream_shape_force_body_flag_is_inert(shape):
    with _offline_tracing():
        resp = _post(_client(shape), accept="text/event-stream", flags={"force": True})
    assert resp.status_code == 200
    assert "text/event-stream" in resp.headers["content-type"]


# AXIS 5 — embeds (x-ag-workflow-embeds: resolve) x shape
# resolve is stripped by ResolverMiddleware before any handler runs; inert here too
@pytest.mark.parametrize("shape", BATCH_SHAPES)
def test_batch_shape_embeds_header_is_inert(shape):
    with _offline_tracing():
        resp = _post(_client(shape), accept="application/json", embeds="resolve")
    assert resp.status_code == 200
    assert resp.json()["data"]["outputs"]["messages"][-1]["content"] == "reply:x"


@pytest.mark.parametrize("shape", STREAM_SHAPES)
def test_stream_shape_embeds_header_is_inert(shape):
    with _offline_tracing():
        resp = _post(_client(shape), accept="text/event-stream", embeds="resolve")
    assert resp.status_code == 200
    assert "text/event-stream" in resp.headers["content-type"]


@pytest.mark.parametrize("shape", BATCH_SHAPES)
def test_batch_shape_resolve_body_flag_is_inert(shape):
    with _offline_tracing():
        resp = _post(
            _client(shape), accept="application/json", flags={"resolve": False}
        )
    assert resp.status_code == 200
    assert resp.json()["data"]["outputs"]["messages"][-1]["content"] == "reply:x"


# Explicit body flags win over header sugar (precedence)
@pytest.mark.parametrize("shape", STREAM_SHAPES)
def test_body_stream_flag_wins_over_json_accept(shape):
    with _offline_tracing():
        resp = _post(_client(shape), accept="application/json", flags={"stream": True})
    assert resp.status_code == 406


@pytest.mark.parametrize("shape", STREAM_SHAPES)
def test_body_trim_flag_does_not_rescue_json_accept(shape):
    with _offline_tracing():
        resp = _post(
            _client(shape),
            accept="application/json",
            transcript="full",
            flags={"trim": True},
        )
    assert resp.status_code == 406
