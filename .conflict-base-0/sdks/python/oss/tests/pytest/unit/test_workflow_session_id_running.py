"""
`session_id` rides the same SDK rail as `trace_id` / `span_id`: read off the
request, echoed onto the response — for ANY workflow, not just the agent
`/messages` adapter. (Charset validation / 400 stays a routing concern; echo+mint
is the running concern, tested here at `wf.invoke()` level.)

  - provided + valid -> echoed onto response.session_id
  - absent           -> minted (sess_<...>) onto response.session_id

RED today: only the vercel `/messages` adapter sets response.session_id; plain
`wf.invoke()` leaves it None.
"""

from contextlib import contextmanager

import pytest
from unittest.mock import MagicMock, patch

from agenta.sdk.decorators.running import workflow
from agenta.sdk.models.workflows import WorkflowServiceRequest


@contextmanager
def _quiet_runtime():
    with patch("agenta.sdk.decorators.tracing.ag") as trace_ag:
        span = MagicMock()
        span.is_recording.return_value = False
        span.get_span_context.return_value = MagicMock(trace_id=0, span_id=0)
        trace_ag.tracing = MagicMock()
        trace_ag.tracing.get_current_span.return_value = span
        trace_ag.tracing.redact = None
        tracer = MagicMock()
        tracer.start_as_current_span.return_value.__enter__ = MagicMock(
            return_value=span
        )
        tracer.start_as_current_span.return_value.__exit__ = MagicMock(
            return_value=None
        )
        trace_ag.tracer = tracer
        with patch("agenta.sdk.decorators.running.ag") as run_ag:
            run_ag.DEFAULT_AGENTA_SINGLETON_INSTANCE = MagicMock()
            run_ag.DEFAULT_AGENTA_SINGLETON_INSTANCE.api_key = None
            yield


def _batch_wf():
    @workflow()
    async def wf(value: str = "x"):
        return f"ok:{value}"

    return wf


@pytest.mark.asyncio
async def test_provided_session_id_is_echoed_on_response():
    with _quiet_runtime():
        resp = await _batch_wf().invoke(
            request=WorkflowServiceRequest(
                data={"inputs": {"value": "x"}}, session_id="sess_abc"
            )
        )
    assert resp.session_id == "sess_abc"


@pytest.mark.asyncio
async def test_absent_session_id_is_minted_on_response():
    with _quiet_runtime():
        resp = await _batch_wf().invoke(
            request=WorkflowServiceRequest(data={"inputs": {"value": "x"}})
        )
    assert isinstance(resp.session_id, str)
    # minted = bare uuid4 hex: 32 hex chars, no dashes, no prefix
    assert len(resp.session_id) == 32
    assert all(c in "0123456789abcdef" for c in resp.session_id)


@pytest.mark.asyncio
async def test_session_id_echoed_on_error_response():
    with _quiet_runtime():

        @workflow()
        async def wf(value: str = "x"):
            raise RuntimeError("boom")

        resp = await wf.invoke(
            request=WorkflowServiceRequest(
                data={"inputs": {"value": "x"}}, session_id="sess_err"
            )
        )
    # an errored run still echoes session_id so the client can correlate it
    assert resp.session_id == "sess_err"


@pytest.mark.asyncio
async def test_session_id_echoed_on_streaming_response():
    with _quiet_runtime():

        @workflow()
        async def wf(value: str = "x"):
            yield f"a:{value}"

        resp = await wf.invoke(
            request=WorkflowServiceRequest(
                data={"inputs": {"value": "x"}, "stream": True},
                session_id="sess_stream",
            )
        )
    assert resp.session_id == "sess_stream"


# --------------------------------------------------------------------------- #
# ROUTING: both inbound channels (body field OR x-ag-session-id header) normalize
# to request.session_id; both outbound (response.session_id field + header).
# --------------------------------------------------------------------------- #
from fastapi import FastAPI  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

from agenta.sdk.decorators.routing import route  # noqa: E402


def _route_client():
    app = FastAPI()

    @app.middleware("http")
    async def _fake_auth(request, call_next):
        request.state.auth = {}
        return await call_next(request)

    @route("/", app=app)
    async def wf(value: str = "x"):
        return f"ok:{value}"

    return TestClient(app)


def test_header_session_id_normalized_and_echoed():
    with _quiet_runtime():
        resp = _route_client().post(
            "/invoke",
            json={"data": {"inputs": {"value": "x"}}},
            headers={"accept": "application/json", "x-ag-session-id": "sess_hdr"},
        )
    assert resp.status_code == 200
    # outbound header echoes it
    assert resp.headers.get("x-ag-session-id") == "sess_hdr"
    # and the response field carries it
    assert resp.json()["session_id"] == "sess_hdr"


def test_body_session_id_emitted_as_header():
    with _quiet_runtime():
        resp = _route_client().post(
            "/invoke",
            json={"data": {"inputs": {"value": "x"}}, "session_id": "sess_body"},
            headers={"accept": "application/json"},
        )
    assert resp.status_code == 200
    assert resp.headers.get("x-ag-session-id") == "sess_body"
    assert resp.json()["session_id"] == "sess_body"
