"""
ROUTING: over the REAL `/invoke` route, an `Accept` header is HTTP sugar for the
canonical `flags.stream` command. A batch Accept (application/json) against a
streaming handler must AGGREGATE into a batch — not 406 — because the endpoint
maps Accept -> flags.stream=False and the normalizer drains the generator.

A stream Accept (text/event-stream) still streams. An explicit `flags.stream` in
the body wins over the header.

Driven through a Starlette TestClient on the real `route()` wiring (mirrors
test_messages_endpoint.py): bare app (no auth middleware) + a stand-in that sets
request.state.auth, and the offline tracing mock so `wf.invoke` runs without
`ag.init()`.
"""

from contextlib import contextmanager

from fastapi import FastAPI
from fastapi.testclient import TestClient

from agenta.sdk.decorators.routing import route


@contextmanager
def _offline_tracing():
    from unittest.mock import MagicMock, patch

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


def _client() -> TestClient:
    app = FastAPI()

    @app.middleware("http")
    async def _fake_auth(request, call_next):
        request.state.auth = {}
        return await call_next(request)

    @route("/", app=app)
    async def wf(value: str = "x"):
        yield f"a:{value}"
        yield f"b:{value}"

    return TestClient(app)


def _post(client, *, accept, flags=None, history_header=None):
    body = {"data": {"inputs": {"value": "x"}}}
    if flags is not None:
        body["flags"] = flags
    headers = {"accept": accept}
    if history_header is not None:
        headers["x-ag-messages-history"] = history_header
    return client.post("/invoke", json=body, headers=headers)


def test_json_accept_aggregates_streaming_handler_to_batch():
    with _offline_tracing():
        resp = _post(_client(), accept="application/json", flags={"history": True})

    assert resp.status_code == 200
    assert "application/json" in resp.headers["content-type"]
    body = resp.json()
    assert body["data"]["outputs"] == ["a:x", "b:x"]


def test_json_accept_default_history_is_last_only():
    with _offline_tracing():
        resp = _post(_client(), accept="application/json")

    assert resp.status_code == 200
    body = resp.json()
    assert body["data"]["outputs"] == ["b:x"]


def test_history_full_header_keeps_full_list():
    # Negotiation 3: `x-ag-messages-history: full` is HTTP sugar for `flags.history=True`,
    # mirroring Accept->stream. A batch Accept aggregates; history=full keeps all events.
    with _offline_tracing():
        resp = _post(_client(), accept="application/json", history_header="full")

    assert resp.status_code == 200
    assert resp.json()["data"]["outputs"] == ["a:x", "b:x"]


def test_history_last_header_trims_to_last():
    with _offline_tracing():
        resp = _post(_client(), accept="application/json", history_header="last")

    assert resp.status_code == 200
    assert resp.json()["data"]["outputs"] == ["b:x"]


def test_explicit_history_flag_wins_over_header():
    # body flag history=True must NOT be overridden by the `last` header (body wins).
    with _offline_tracing():
        resp = _post(
            _client(),
            accept="application/json",
            flags={"history": True},
            history_header="last",
        )

    assert resp.status_code == 200
    assert resp.json()["data"]["outputs"] == ["a:x", "b:x"]


def test_sse_accept_still_streams():
    with _offline_tracing():
        resp = _post(_client(), accept="text/event-stream")

    assert resp.status_code == 200
    assert "text/event-stream" in resp.headers["content-type"]


def test_explicit_stream_flag_wins_over_accept():
    # body says stream=True; a json Accept must NOT override it back to batch.
    with _offline_tracing():
        resp = _post(_client(), accept="application/json", flags={"stream": True})

    # stream=True forces a streaming response; json Accept then can't be satisfied
    # as a stream -> 406 (the explicit command won, the header lost).
    assert resp.status_code == 406


def _error_client() -> TestClient:
    app = FastAPI()

    @app.middleware("http")
    async def _fake_auth(request, call_next):
        request.state.auth = {}
        return await call_next(request)

    # Mirrors the real agent handler: an async function that raises while resolving
    # (NOT a generator) — the normalizer catches it into a batch error response.
    @route("/", app=app)
    async def wf(value: str = "x"):
        raise ValueError("boom")

    return TestClient(app)


def test_error_with_stream_accept_returns_json_error_not_406():
    # An errored handler yields a batch error response even though the caller asked
    # for a stream. The route must surface the real error (JSON, the handler's code)
    # instead of 406ing on the format mismatch — a 406 would mask the actual error.
    with _offline_tracing():
        resp = _post(_error_client(), accept="text/event-stream")

    assert resp.status_code == 500
    assert "application/json" in resp.headers["content-type"]
    assert resp.json()["status"]["message"] == "boom"


def _branching_client() -> TestClient:
    """Mirrors the agent handler: reads `request.flags.stream` to branch generator vs batch."""
    from agenta.sdk.models.workflows import (
        WorkflowInvokeRequestFlags,
        WorkflowServiceRequest,
    )

    app = FastAPI()

    @app.middleware("http")
    async def _fake_auth(request, call_next):
        request.state.auth = {}
        return await call_next(request)

    @route("/", app=app)
    async def wf(request: WorkflowServiceRequest, value: str = "x"):
        stream = WorkflowInvokeRequestFlags(**(request.flags or {})).stream
        if stream:

            async def gen():
                yield f"a:{value}"
                yield f"b:{value}"

            return gen()
        return f"batch:{value}"

    return TestClient(app)


def test_stream_accept_drives_handler_flags_stream_to_generator_branch():
    # The negotiated stream decision (Accept -> flags.stream) must reach a handler
    # reading request.flags.stream, so it takes its generator branch — otherwise it
    # returns a batch and the route 406s the stream request (the agent's failure mode).
    with _offline_tracing():
        resp = _branching_client().post(
            "/invoke",
            json={"data": {"inputs": {"value": "x"}}},
            headers={"accept": "text/event-stream"},
        )

    assert resp.status_code == 200
    assert "text/event-stream" in resp.headers["content-type"]


def test_json_accept_drives_handler_flags_stream_to_batch_branch():
    with _offline_tracing():
        resp = _branching_client().post(
            "/invoke",
            json={"data": {"inputs": {"value": "x"}}},
            headers={"accept": "application/json"},
        )

    assert resp.status_code == 200
    assert resp.json()["data"]["outputs"] == "batch:x"


def test_error_with_vercel_stream_accept_returns_json_with_vercel_headers():
    with _offline_tracing():
        resp = _error_client().post(
            "/invoke",
            json={"data": {"inputs": {"value": "x"}}},
            headers={
                "accept": "text/event-stream",
                "x-ag-messages-format": "vercel",
            },
        )

    assert resp.status_code == 500
    assert "application/json" in resp.headers["content-type"]
    assert resp.headers.get("x-ag-messages-format") == "vercel"
