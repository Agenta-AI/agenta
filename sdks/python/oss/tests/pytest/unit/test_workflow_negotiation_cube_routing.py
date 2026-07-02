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
    history   ∈ {unset/last, full}                           (x-ag-messages-history)

It asserts the RESPONSE (status, media type, body/stream framing, vercel projection,
history trim). It does NOT assert traces — the span tree is invariant across these
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


# --------------------------------------------------------------------------- #
# Offline runtime (tracing + singleton not under test)
# --------------------------------------------------------------------------- #
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


# --------------------------------------------------------------------------- #
# Handlers — the per-layer shapes `/invoke` actually carries (see services agent
# app.py): the BATCH path returns the canonical agent `{messages:[{role,content}]}`
# envelope (Agenta messages), the STREAM path yields Agenta EVENTS `{type, data}`
# (the AgentStream's AgentEvents — message_start/_delta/_end, usage, done). The
# stream handlers delegate to the real mock_v0 `events` behavior so the wire is
# the genuine agenta event vocabulary, not ad-hoc chunks.
#
# We keep the four Python shapes (sync/async × batch/stream) because the routing
# + normalizer behavior is shape-sensitive; only the PAYLOAD is made faithful.
# --------------------------------------------------------------------------- #
from agenta.sdk.workflows.handlers import _mock_messages, _mock_events  # noqa: E402


def _batch_envelope(value: str):
    # Mirrors _mock_messages / _agent_batch: the {messages:[...]} output envelope.
    return _mock_messages(text=f"reply:{value}")


async def _event_stream(value: str):
    # Mirrors _agent_event_stream: yield the agenta event stream {type, data}.
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
            # sync generator yielding the same agenta event vocabulary (a sync gen
            # cannot drive the async mock, so emit the canonical events directly).
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


def _post(client, *, accept=None, fmt=None, history=None, flags=None):
    headers = {}
    if accept is not None:
        headers["accept"] = accept
    if fmt is not None:
        headers["x-ag-messages-format"] = fmt
    if history is not None:
        headers["x-ag-messages-history"] = history
    body = {"data": {"inputs": {"value": "x"}}}
    if flags is not None:
        body["flags"] = flags
    return client.post("/invoke", json=body, headers=headers)


SHAPES = ["sync-fn", "async-fn", "sync-gen", "async-gen"]
BATCH_SHAPES = ["sync-fn", "async-fn"]
STREAM_SHAPES = ["sync-gen", "async-gen"]


# =========================================================================== #
# AXIS 1 — transport (Accept) x shape
# =========================================================================== #
@pytest.mark.parametrize("shape", BATCH_SHAPES)
@pytest.mark.parametrize("accept", [None, "application/json"])
def test_batch_shape_batch_accept_is_json(shape, accept):
    with _offline_tracing():
        resp = _post(_client(shape), accept=accept)
    assert resp.status_code == 200
    assert "application/json" in resp.headers["content-type"]
    # batch shape returns the canonical agent envelope: one assistant message.
    msgs = resp.json()["data"]["outputs"]["messages"]
    assert msgs[-1]["role"] == "assistant"
    assert msgs[-1]["content"] == "reply:x"


@pytest.mark.parametrize("shape", BATCH_SHAPES)
@pytest.mark.parametrize("accept", ["text/event-stream", "application/x-ndjson"])
def test_batch_shape_stream_accept_is_406(shape, accept):
    # A pure batch handler cannot satisfy a stream Accept -> 406.
    with _offline_tracing():
        resp = _post(_client(shape), accept=accept)
    assert resp.status_code == 406


@pytest.mark.parametrize("shape", STREAM_SHAPES)
def test_stream_shape_no_accept_aggregates_to_batch(shape):
    # Over the REAL route, the endpoint sets `flags.stream = (accept in STREAM_TYPES)`.
    # With no Accept (`*/*`/absent), _parse_accept returns None, so stream=False and
    # the normalizer drains the generator to a BATCH JSON response. This differs from
    # the handle_invoke_success-level "stream + none -> ndjson" in
    # test_workflow_negotiation_routing.py: that test feeds an already-built stream
    # response; here the endpoint decides stream=False BEFORE the handler runs. To get
    # ndjson with no Accept, set body flags.stream=True explicitly.
    with _offline_tracing():
        resp = _post(_client(shape), accept=None)
    assert resp.status_code == 200
    assert "application/json" in resp.headers["content-type"]


@pytest.mark.parametrize("shape", STREAM_SHAPES)
def test_stream_shape_no_accept_with_stream_flag_is_ndjson(shape):
    # The explicit per-call command restores streaming when there is no Accept header.
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
def test_stream_shape_json_accept_aggregates_events_to_batch(shape):
    # The invoke-absorbs-messages behavior: a batch Accept maps to flags.stream=False;
    # the normalizer drains the AGENTA EVENT generator into a batch list instead of
    # 406ing. Aggregating an event stream yields the event list (NOT a coalesced
    # messages envelope — that's the agent's separate _agent_batch path). history
    # defaults to last -> only the final event (`done`) survives.
    with _offline_tracing():
        resp = _post(_client(shape), accept="application/json")
    assert resp.status_code == 200
    assert "application/json" in resp.headers["content-type"]
    outputs = resp.json()["data"]["outputs"]
    assert outputs[-1]["type"] == "done"  # last event is the terminal `done`


# =========================================================================== #
# AXIS 3 — history x shape (batch direction; full vs last)
# =========================================================================== #
@pytest.mark.parametrize("shape", STREAM_SHAPES)
def test_stream_shape_json_accept_history_full_keeps_all_events(shape):
    with _offline_tracing():
        resp = _post(_client(shape), accept="application/json", history="full")
    assert resp.status_code == 200
    outputs = resp.json()["data"]["outputs"]
    # full -> every agenta event retained, in order, ending with `done`.
    types = [e["type"] for e in outputs]
    assert types[0] == "message_start"
    assert "message_delta" in types
    assert types[-1] == "done"


@pytest.mark.parametrize("shape", BATCH_SHAPES)
def test_batch_envelope_history_trims_messages_list(shape):
    # For a direct {messages:[...]} return, history trims the messages LIST in
    # place (normalizer's direct-return branch). The agent batch envelope here has
    # a single assistant message, so full and last are both length 1 — assert the
    # trim path runs and the message is preserved either way.
    with _offline_tracing():
        full = _post(_client(shape), accept="application/json", history="full")
        last = _post(_client(shape), accept="application/json", history="last")
    assert full.status_code == last.status_code == 200
    full_msgs = full.json()["data"]["outputs"]["messages"]
    last_msgs = last.json()["data"]["outputs"]["messages"]
    assert len(full_msgs) == 1 and len(last_msgs) == 1
    assert last_msgs[0]["content"] == "reply:x"


# =========================================================================== #
# AXIS 2 — format (agenta vs vercel) x shape
# =========================================================================== #
@pytest.mark.parametrize("shape", BATCH_SHAPES)
def test_batch_vercel_projects_messages_and_sets_headers(shape):
    with _offline_tracing():
        resp = _post(_client(shape), accept="application/json", fmt="vercel")
    assert resp.status_code == 200
    assert resp.headers.get("x-ag-messages-format") == "vercel"
    # The agenta {messages:[...]} envelope is projected to Vercel UIMessage[].
    messages = resp.json()["data"]["outputs"]["messages"]
    assert isinstance(messages, list) and len(messages) >= 1
    # UIMessage carries `parts` (vercel shape), not the raw agenta `content` string.
    assert any("parts" in m for m in messages), "expected projected UIMessage parts"


@pytest.mark.parametrize("shape", BATCH_SHAPES)
def test_batch_agenta_format_is_passthrough(shape):
    with _offline_tracing():
        resp = _post(_client(shape), accept="application/json", fmt="agenta")
    assert resp.status_code == 200
    messages = resp.json()["data"]["outputs"]["messages"]
    # agenta canonical shape keeps role/content, no `parts` projection.
    assert all("content" in m for m in messages)


@pytest.mark.parametrize("shape", STREAM_SHAPES)
def test_stream_vercel_is_sse_with_vercel_headers(shape):
    with _offline_tracing():
        resp = _post(_client(shape), accept="text/event-stream", fmt="vercel")
    assert resp.status_code == 200
    assert "text/event-stream" in resp.headers["content-type"]
    assert resp.headers.get("x-ag-messages-format") == "vercel"
    # The Vercel UI message stream terminates with `data: [DONE]`.
    assert "[DONE]" in resp.text


@pytest.mark.parametrize("shape", STREAM_SHAPES)
def test_stream_agenta_sse_is_plain_sse(shape):
    with _offline_tracing():
        resp = _post(_client(shape), accept="text/event-stream", fmt="agenta")
    assert resp.status_code == 200
    assert "text/event-stream" in resp.headers["content-type"]
    # plain SSE frames the agenta envelopes as `data: {json}` (no vercel [DONE]).
    assert "data:" in resp.text


# =========================================================================== #
# Explicit body flags win over header sugar (precedence)
# =========================================================================== #
@pytest.mark.parametrize("shape", STREAM_SHAPES)
def test_body_stream_flag_wins_over_json_accept(shape):
    with _offline_tracing():
        resp = _post(_client(shape), accept="application/json", flags={"stream": True})
    # stream=True forces a stream; a json Accept can't be satisfied -> 406.
    assert resp.status_code == 406


@pytest.mark.parametrize("shape", STREAM_SHAPES)
def test_body_history_flag_wins_over_header(shape):
    # body flags.history=True must override the `last` header sugar: the aggregated
    # event list keeps ALL events (>1), ending with `done`, not trimmed to last.
    with _offline_tracing():
        full = _post(
            _client(shape),
            accept="application/json",
            history="last",
            flags={"history": True},
        )
        last = _post(_client(shape), accept="application/json", history="last")
    assert full.status_code == last.status_code == 200
    full_events = full.json()["data"]["outputs"]
    last_events = last.json()["data"]["outputs"]
    assert len(full_events) > 1 and full_events[-1]["type"] == "done"
    assert len(last_events) == 1  # header `last` won when no body flag
