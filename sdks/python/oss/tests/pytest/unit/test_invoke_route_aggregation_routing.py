"""
ROUTING: over the REAL `/invoke` route, an `Accept` header is HTTP sugar for the
canonical `flags.stream` command. A batch Accept (application/json) against a
stream-only handler (generator, no `request` param) 406s — no courtesy
aggregation (specs.md "Removals").

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


def _post(
    client,
    *,
    accept,
    flags=None,
    transcript_header=None,
    control_header=None,
    embeds_header=None,
):
    body = {"data": {"inputs": {"value": "x"}}}
    if flags is not None:
        body["flags"] = flags
    headers = {"accept": accept}
    if transcript_header is not None:
        headers["x-ag-messages-transcript"] = transcript_header
    if control_header is not None:
        headers["x-ag-session-control"] = control_header
    if embeds_header is not None:
        headers["x-ag-workflow-embeds"] = embeds_header
    return client.post("/invoke", json=body, headers=headers)


def test_json_accept_on_stream_only_handler_is_406():
    with _offline_tracing():
        resp = _post(_client(), accept="application/json", flags={"trim": True})

    assert resp.status_code == 406


def test_json_accept_default_on_stream_only_handler_is_406():
    with _offline_tracing():
        resp = _post(_client(), accept="application/json")

    assert resp.status_code == 406


def test_transcript_last_header_on_stream_only_handler_is_406():
    with _offline_tracing():
        resp = _post(_client(), accept="application/json", transcript_header="last")

    assert resp.status_code == 406


def test_transcript_full_header_on_stream_only_handler_is_406():
    with _offline_tracing():
        resp = _post(_client(), accept="application/json", transcript_header="full")

    assert resp.status_code == 406


def test_explicit_trim_flag_on_stream_only_handler_is_406():
    with _offline_tracing():
        resp = _post(
            _client(),
            accept="application/json",
            flags={"trim": True},
            transcript_header="last",
        )

    assert resp.status_code == 406


def test_sse_accept_still_streams():
    with _offline_tracing():
        resp = _post(_client(), accept="text/event-stream")

    assert resp.status_code == 200
    assert "text/event-stream" in resp.headers["content-type"]


def test_explicit_stream_flag_wins_over_accept():
    # body stream=True must win over a json Accept -> 406, not overridden to batch.
    with _offline_tracing():
        resp = _post(_client(), accept="application/json", flags={"stream": True})

    assert resp.status_code == 406


def _error_client() -> TestClient:
    app = FastAPI()

    @app.middleware("http")
    async def _fake_auth(request, call_next):
        request.state.auth = {}
        return await call_next(request)

    # Raises while resolving (not a generator) -> normalizer catches it as a batch error.
    @route("/", app=app)
    async def wf(value: str = "x"):
        raise ValueError("boom")

    return TestClient(app)


def test_error_with_stream_accept_returns_json_error_not_406():
    # Route must surface the real error, not 406 on the format mismatch.
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
    # Negotiated stream decision must reach request.flags.stream to pick the generator branch.
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


# force/embeds headers stay inert on the branching client (doesn't read those flags).
def test_force_header_inert_on_batch_branch():
    with _offline_tracing():
        resp = _post(
            _branching_client(), accept="application/json", control_header="force"
        )
    assert resp.status_code == 200
    assert resp.json()["data"]["outputs"] == "batch:x"


def test_force_header_inert_on_stream_branch():
    with _offline_tracing():
        resp = _post(
            _branching_client(),
            accept="text/event-stream",
            control_header="force",
        )
    assert resp.status_code == 200
    assert "text/event-stream" in resp.headers["content-type"]


def test_embeds_header_inert_on_batch_branch():
    with _offline_tracing():
        resp = _post(
            _branching_client(), accept="application/json", embeds_header="resolve"
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
