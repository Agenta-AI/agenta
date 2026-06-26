"""
Full symmetric propagation of the three correlation ids — trace_id, span_id,
session_id — across every applicable channel, request and response.

Channels:
  - traceparent (W3C): trace_id + span_id ONLY (cannot carry session_id).
  - baggage (W3C): session_id via ``ag.session.id`` (+ readable for the rest).
  - x-ag-* headers: x-ag-trace-id / x-ag-span-id / x-ag-session-id (our namespace).
  - request body field: session_id (first-class on the request).

Rules under test:
  INBOUND (all optional; normalized into context / request.session_id):
    - traceparent -> parent trace context (existing).
    - x-ag-trace-id + x-ag-span-id -> parent trace context (alternative to traceparent).
    - x-ag-session-id OR baggage ag.session.id OR body session_id -> request.session_id.
  MINT: session_id minted (uuid4().hex, no dashes/prefix) inside the instrumented
    workflow when absent, and emitted on the OTel span as ``session.id``.
  OUTBOUND (emit all forms):
    - response fields trace_id / span_id / session_id.
    - traceparent (trace+span) + x-ag-trace-id / x-ag-span-id (existing).
    - x-ag-session-id + baggage ag.session.id.

These are RED until the symmetric wiring lands.
"""

from contextlib import contextmanager

from unittest.mock import MagicMock, patch
from fastapi import FastAPI
from fastapi.testclient import TestClient

from agenta.sdk.decorators.routing import route
from agenta.sdk.models.shared import resolve_session_id


# --------------------------------------------------------------------------- #
# Pure mint policy
# --------------------------------------------------------------------------- #
def test_mint_is_bare_uuid4_hex_no_prefix():
    sid = resolve_session_id(None)
    assert len(sid) == 32 and all(c in "0123456789abcdef" for c in sid)


def test_valid_id_echoed_invalid_rejected():
    assert resolve_session_id("sess.ok-1") == "sess.ok-1"
    assert resolve_session_id("bad id!") is None  # space + '!' out of charset


# --------------------------------------------------------------------------- #
# Route harness
# --------------------------------------------------------------------------- #
@contextmanager
def _offline_tracing():
    with (
        patch("agenta.sdk.decorators.tracing.ag") as mock_ag,
        patch("agenta.sdk.decorators.running.ag") as mock_run_ag,
    ):
        span = MagicMock()
        span.is_recording.return_value = True
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
        yield span


# The workflow URI is derived from the handler's {module}.{name}; reusing one name
# across tests collides in the global handler registry. Give each registration a
# unique name so tests don't clobber each other under the shared/parallel runner.
_uid = 0


def _unique(fn):
    global _uid
    _uid += 1
    fn.__name__ = f"{fn.__name__}_{_uid}"
    return fn


def _client():
    app = FastAPI()

    @app.middleware("http")
    async def _fake_auth(request, call_next):
        request.state.auth = {}
        # the OTel middleware normally seeds this; emulate empty for unit scope
        if not hasattr(request.state, "otel"):
            request.state.otel = {"baggage": {}, "traceparent": None}
        return await call_next(request)

    async def wf(value: str = "x"):
        return f"ok:{value}"

    route("/", app=app)(_unique(wf))
    return TestClient(app)


def _post(client, *, json=None, headers=None):
    return client.post(
        "/invoke",
        json=json or {"data": {"inputs": {"value": "x"}}},
        headers={"accept": "application/json", **(headers or {})},
    )


# --------------------------------------------------------------------------- #
# INBOUND session_id: body / x-ag / baggage all normalize to request.session_id
# (asserted via the echoed response)
# --------------------------------------------------------------------------- #
def test_session_inbound_body():
    with _offline_tracing():
        r = _post(
            _client(), json={"data": {"inputs": {"value": "x"}}, "session_id": "s_body"}
        )
    assert r.json()["session_id"] == "s_body"
    assert r.headers.get("x-ag-session-id") == "s_body"


def test_session_inbound_xag_header():
    with _offline_tracing():
        r = _post(_client(), headers={"x-ag-session-id": "s_hdr"})
    assert r.json()["session_id"] == "s_hdr"
    assert r.headers.get("x-ag-session-id") == "s_hdr"


def test_session_inbound_baggage():
    with _offline_tracing():
        r = _post(_client(), headers={"baggage": "ag.session.id=s_bag"})
    assert r.json()["session_id"] == "s_bag"
    assert r.headers.get("x-ag-session-id") == "s_bag"


def test_session_minted_when_absent_and_on_span():
    import agenta as ag

    with _offline_tracing():
        with patch.object(ag, "tracing") as mock_tracing:
            r = _post(_client())
    sid = r.json()["session_id"]
    assert len(sid) == 32
    assert r.headers.get("x-ag-session-id") == sid
    # the resolved/minted id is emitted on the active span via store_session
    mock_tracing.store_session.assert_called_with(session_id=sid)


# --------------------------------------------------------------------------- #
# OUTBOUND session_id: baggage form alongside x-ag + field
# --------------------------------------------------------------------------- #
def test_session_outbound_baggage_header():
    with _offline_tracing():
        r = _post(
            _client(), json={"data": {"inputs": {"value": "x"}}, "session_id": "s_out"}
        )
    bag = r.headers.get("baggage", "")
    assert "ag.session.id=s_out" in bag


# --------------------------------------------------------------------------- #
# INBOUND trace/span via x-ag headers (optional alternative to traceparent):
# normalized into req.state.otel traceparent so the run parents correctly.
# --------------------------------------------------------------------------- #
def test_trace_span_inbound_via_xag_headers():
    from agenta.sdk.middlewares.routing.otel import OTelMiddleware

    app = FastAPI()
    seen = {}

    # synthesis lives in OTelMiddleware, so the test wires it (not a bare app)
    app.add_middleware(OTelMiddleware)

    @app.middleware("http")
    async def _fake_auth(request, call_next):
        request.state.auth = {}
        return await call_next(request)

    async def wf(value: str = "x"):
        from agenta.sdk.contexts.tracing import TracingContext

        seen["traceparent"] = TracingContext.get().traceparent
        return "ok"

    route("/", app=app)(_unique(wf))
    client = TestClient(app)
    with _offline_tracing():
        client.post(
            "/invoke",
            json={"data": {"inputs": {"value": "x"}}},
            headers={
                "accept": "application/json",
                "x-ag-trace-id": "0af7651916cd43dd8448eb211c80319c",
                "x-ag-span-id": "b7ad6b7169203331",
            },
        )
    # the x-ag trace/span were turned into a parent trace context
    assert seen["traceparent"] is not None
