"""Every error a RUN produces carries an `x-ag-` header on its response.

This is not a cosmetic contract. The API reads its absence as proof, on the narrow statuses a
proxy can produce: when a detached start comes back 404 or 503 with no `x-ag-` header, the API
concludes the workflow service never saw the request and releases a one-shot dispatch claim, so
one retry may start the turn again (`api/oss/src/core/workflows/types.py`,
`detached_start_never_sent`).

That rule fails OPEN. An unstamped in-run failure would be read as "never dispatched", and the
retry would run a first turn that already executed its tool calls. The two cases below are the
half of the proof that lives in this repo: a batch error envelope goes out through
`_make_json_response`, which stamps it, and a stream commits 200 before the handler body runs,
so an in-run failure can never surface as a bare status at all.

The other half, that the unstamped 404 and 503 responses are all structurally in front of the
workflow (session admission, the auth and vault middlewares, and the router's own "not found"),
is a property of where those sites sit, which no test here can hold still.
"""

from __future__ import annotations

from contextlib import contextmanager
from unittest.mock import MagicMock, patch

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from agenta.sdk.decorators.routing import route
from agenta.sdk.engines.running.errors import ErrorStatus
from agenta.sdk.models.workflows import (
    WorkflowBatchResponse,
    WorkflowServiceRequest,
    WorkflowServiceStatus,
)


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


def _client(fail, *, raise_server_exceptions: bool = True):
    """The real `/invoke` route over a handler that fails the way a run fails."""
    app = FastAPI()

    @app.middleware("http")
    async def _fake_auth(request, call_next):
        request.state.auth = {}
        return await call_next(request)

    @route("/", app=app)
    def wf(request: WorkflowServiceRequest):
        return fail()

    return TestClient(app, raise_server_exceptions=raise_server_exceptions)


def _stream_then_fail():
    """A run that emits one frame and then dies, which is the shape that matters."""

    def fail():
        def gen():
            yield {"type": "message", "data": {"text": "partial"}}
            raise RuntimeError("the run failed after it had already started")

        return gen()

    return fail


def _raise_error_status(code: int, message: str):
    """What a run raises when it gives up part-way.

    `ErrorStatus` is how the agent engine reports a failed turn (`engines/running/errors.py`),
    and the normalizer turns it into a batch response carrying that code
    (`middlewares/running/normalizer.py`, `_normalize_exception`).
    """

    def fail():
        raise ErrorStatus(
            code=code,
            type="https://agenta.ai/docs/errors#test",
            message=message,
        )

    return fail


def _return_error_response(code: int, message: str):
    """The other shape: a handler that returns a typed response carrying a failed status."""

    def fail():
        return WorkflowBatchResponse(
            status=WorkflowServiceStatus(
                code=code,
                type="https://agenta.ai/docs/errors#test",
                message=message,
            )
        )

    return fail


# The Accept the caller sent decides which branch builds the response, and an errored batch
# answered to a stream request takes a branch of its own. `application/x-ndjson` is what the
# API's detached start sends, so it is the one that matters most here.
@pytest.mark.parametrize(
    "accept",
    [None, "application/json", "application/x-ndjson", "text/event-stream"],
)
@pytest.mark.parametrize("build", [_raise_error_status, _return_error_response])
@pytest.mark.parametrize(
    ("status_code", "message"),
    [
        # The dangerous one: a 503 the API must NOT read as "never sent". The agent engine
        # answers exactly this when the model is unavailable, after tool calls may have run.
        (503, "llm_unavailable"),
        (500, "iterations_exhausted"),
        (502, "upstream_failed"),
        (404, "not_found"),
    ],
)
def test_an_in_run_failure_is_stamped_with_an_agenta_header(
    build, accept, status_code, message
):
    client = _client(build(status_code, message))
    with _offline_tracing():
        response = client.post(
            "/invoke",
            json={"data": {"inputs": {}}},
            headers={"accept": accept} if accept else {},
        )

    assert response.status_code == status_code
    stamped = [name for name in response.headers if name.lower().startswith("x-ag-")]
    assert stamped, (
        f"an in-run {status_code} went out unstamped; the API reads a bare 404 or 503 as proof "
        "that the run never started and releases its one-shot dispatch claim"
    )
    assert response.headers["x-ag-version"]


def test_an_unhandled_exception_is_stamped_too():
    def fail():
        raise RuntimeError("the run raised after it had started")

    client = _client(fail)
    with _offline_tracing():
        response = client.post(
            "/invoke",
            json={"data": {"inputs": {}}},
            headers={"accept": "application/x-ndjson"},
        )

    assert response.status_code >= 400
    assert response.headers["x-ag-version"]


def test_a_run_that_fails_after_it_started_streaming_has_already_committed_200():
    """The other half of the reason a bare 404 or 503 is proof.

    Once a stream has begun the status is 200 and a later failure rides the body, so no failure
    inside a started run can present itself to the caller as a status code.
    """
    # The wire's view, not the test client's: a generator that raises mid-body would otherwise
    # re-raise here and hide the status that was already sent.
    client = _client(_stream_then_fail(), raise_server_exceptions=False)
    with _offline_tracing():
        with client.stream(
            "POST",
            "/invoke",
            json={"data": {"inputs": {}}, "flags": {"stream": True}},
            headers={"accept": "application/x-ndjson"},
        ) as response:
            assert response.status_code == 200
