"""
ROUTE layer: the returned-generator shape (`async def -> return gen()`, the agent's
shape) and exception handling over the real `/invoke` route.

The programmatic layer (integration/observability/test_instrument_shapes_exhaustive.py)
proves the SPAN is correct (drained content, no leak, nesting, concurrency). Here we
prove the RESPONSE is correct over the route for the same shape across the transport
negotiation, and that a returned-generator's stream is actually drained to the wire
(never the generator object serialized into the body).

Offline tracing mock (span content is asserted at the programmatic + acceptance layers);
this file asserts HTTP status, media type, and body/stream framing.
"""

from contextlib import contextmanager

import pytest
from unittest.mock import MagicMock, patch

from fastapi import FastAPI
from fastapi.testclient import TestClient

from agenta.sdk.decorators.routing import route


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
        # start_span + use_span (Option 2) are what the fixed instrument uses; mock both.
        mock_ag.tracer = MagicMock()
        mock_run_ag.DEFAULT_AGENTA_SINGLETON_INSTANCE = MagicMock()
        mock_run_ag.DEFAULT_AGENTA_SINGLETON_INSTANCE.api_key = None
        yield


# --------------------------------------------------------------------------- #
# Handlers: async def / sync def that RETURN a generator (no `yield` in the body)
# --------------------------------------------------------------------------- #
def _app(shape: str, *, raise_early=False, raise_mid=False) -> FastAPI:
    app = FastAPI()

    @app.middleware("http")
    async def _fake_auth(request, call_next):
        request.state.auth = {}
        return await call_next(request)

    if shape == "async-ret-gen":

        async def _gen(value):
            yield {"type": "message_start", "data": {"id": "m"}}
            if raise_mid:
                raise RuntimeError("boom")
            yield {"type": "done", "data": {}}

        @route("/", app=app)
        async def wf(value: str = "x"):
            if raise_early:
                raise RuntimeError("boom")
            return _gen(value)

    elif shape == "sync-ret-gen":

        def _gen(value):
            yield {"type": "message_start", "data": {"id": "m"}}
            if raise_mid:
                raise RuntimeError("boom")
            yield {"type": "done", "data": {}}

        @route("/", app=app)
        def wf(value: str = "x"):
            if raise_early:
                raise RuntimeError("boom")
            return _gen(value)

    else:  # pragma: no cover
        raise ValueError(shape)

    return app


def _post(app, *, accept=None, flags=None, raise_server_exceptions=True):
    headers = {"accept": accept} if accept else {}
    body = {"data": {"inputs": {"value": "x"}}}
    if flags is not None:
        body["flags"] = flags
    # raise_server_exceptions=False makes TestClient behave like a real ASGI server:
    # a mid-stream handler error truncates the response instead of re-raising into
    # the test (a real client just sees a cut-off stream, not a Python traceback).
    client = TestClient(app, raise_server_exceptions=raise_server_exceptions)
    return client.post("/invoke", json=body, headers=headers)


RET_GEN_SHAPES = ["async-ret-gen", "sync-ret-gen"]


# =========================================================================== #
# SUCCESS across transport — the returned generator is drained to the wire.
# The body must carry the EVENTS, never a serialized generator object.
# =========================================================================== #
@pytest.mark.parametrize("shape", RET_GEN_SHAPES)
def test_ret_gen_sse_streams_events(shape):
    with _offline_tracing():
        resp = _post(_app(shape), accept="text/event-stream")
    assert resp.status_code == 200
    assert "text/event-stream" in resp.headers["content-type"]
    assert "message_start" in resp.text and "done" in resp.text
    assert "generator object" not in resp.text


@pytest.mark.parametrize("shape", RET_GEN_SHAPES)
def test_ret_gen_ndjson_streams_events(shape):
    with _offline_tracing():
        resp = _post(_app(shape), accept="application/x-ndjson")
    assert resp.status_code == 200
    assert "application/x-ndjson" in resp.headers["content-type"]
    assert "message_start" in resp.text
    assert "generator object" not in resp.text


@pytest.mark.parametrize("shape", RET_GEN_SHAPES)
def test_ret_gen_json_accept_aggregates_to_batch(shape):
    # batch Accept -> flags.stream=False -> normalizer drains the returned generator
    # into a batch list. The events land in the body; never the generator object.
    with _offline_tracing():
        resp = _post(_app(shape), accept="application/json", flags={"history": True})
    assert resp.status_code == 200
    assert "application/json" in resp.headers["content-type"]
    outputs = resp.json()["data"]["outputs"]
    assert isinstance(outputs, list)
    assert outputs[-1]["type"] == "done"
    assert "generator object" not in resp.text


# =========================================================================== #
# EXCEPTION over the route
# =========================================================================== #
@pytest.mark.parametrize("shape", RET_GEN_SHAPES)
def test_ret_gen_raise_early_is_json_error(shape):
    # raise before returning the generator -> batch error response (500), even for
    # a stream Accept: the route surfaces the real error instead of 406ing.
    with _offline_tracing():
        resp = _post(_app(shape, raise_early=True), accept="text/event-stream")
    assert resp.status_code == 500
    assert "application/json" in resp.headers["content-type"]
    assert resp.json()["status"]["message"] == "boom"


@pytest.mark.parametrize("shape", RET_GEN_SHAPES)
def test_ret_gen_raise_mid_stream_surfaces(shape):
    # raise after the first event: SSE headers were already flushed (200), so a real
    # server can't change the status — it truncates the stream. The pre-error event
    # reached the wire; the generator object never leaked. Use
    # raise_server_exceptions=False so TestClient models the real server (otherwise it
    # re-raises the handler error into the test, which is a TestClient artifact, not
    # the client-observable behavior).
    with _offline_tracing():
        resp = _post(
            _app(shape, raise_mid=True),
            accept="text/event-stream",
            raise_server_exceptions=False,
        )
    assert resp.status_code == 200
    assert "message_start" in resp.text
    assert "generator object" not in resp.text
