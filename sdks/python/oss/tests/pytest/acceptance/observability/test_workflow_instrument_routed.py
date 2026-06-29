"""
ROUTED layer, LIVE backend: invoke a `route()`-mounted `/invoke` and assert the
EMITTED TRACE read back from the traces API — plus W3C context propagation.

This is the acceptance counterpart to:
  - integration/observability/test_workflow_instrument_programmatic.py
    (programmatic span tree, in-memory, no backend), and
  - unit/test_workflow_negotiation_cube_routing.py
    (routed RESPONSE cube, offline TestClient).

Here `ag.init()` wires the REAL OTLP exporter, so spans an in-process `/invoke`
emits are shipped to the running backend; we then poll the traces API and assert:

  - STRUCTURE: one root span named after the handler, no parent, OK status.
  - CONTENT  : nested `ag` attribute tree — `ag.type.node == "workflow"`,
               `ag.data.inputs.value`, `ag.data.outputs.__default__`.
               (On READ the API un-flattens the dotted keys into a nested `ag`
               dict — see api/oss/src/core/tracing/utils/attributes.py
               `unmarshall_attributes`. So assertions here are nested, unlike the
               dotted in-memory assertions in the programmatic test.)
  - INVARIANCE: the span tree is the SAME regardless of Accept/format/history
               (the three negotiations change the RESPONSE, not the trace).
  - PROPAGATION: an inbound `traceparent` makes the root span a child of the
               remote span (shared trace id, parent = remote span id).

Requires a fully running system: AGENTA_API_URL + AGENTA_AUTH_KEY (OTLP ingest +
tracing worker + traces API). Marked `acceptance`; skipped otherwise.

NOTE on content capture: these content assertions assume the SDK/backend leave
prompt/completion capture ON. If the test environment sets capture off or a redact
hook, the `ag.data.*` assertions will (correctly) fail — pin the env when running.
"""

import time

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

import agenta as ag
from agenta.sdk.decorators.routing import route


pytestmark = [pytest.mark.acceptance]


# --------------------------------------------------------------------------- #
# Trace polling (worker lag — mirror test_observability_traces.py)
# --------------------------------------------------------------------------- #
def _poll_trace(trace_id, *, max_retries=15, initial_delay=0.5, max_delay=8.0):
    delay = initial_delay
    fetched = None
    for attempt in range(max_retries):
        fetched = ag.api.traces.fetch_trace(trace_id)
        if fetched and fetched.trace is not None and fetched.trace.spans:
            return fetched
        if attempt < max_retries - 1:
            time.sleep(delay)
            delay = min(delay * 2, max_delay)
    return fetched


def _root_span(trace):
    """The single parent-less span in the fetched tree (keyed by span_name)."""
    spans = trace.spans or {}
    for s in spans.values():
        if s is not None and getattr(s, "parent_id", None) is None:
            return s
    # fall back to the first span if the tree was returned root-keyed
    return next(iter(spans.values())) if spans else None


def _ag(span):
    """The nested `ag` attribute subtree the read path un-flattens to."""
    attrs = span.attributes or {}
    return attrs.get("ag", {}) if isinstance(attrs, dict) else {}


# --------------------------------------------------------------------------- #
# In-process routed app over the REAL exporter
# --------------------------------------------------------------------------- #
def _client(handler) -> TestClient:
    app = FastAPI()

    @app.middleware("http")
    async def _fake_auth(request, call_next):
        # The real auth middleware is bypassed for the in-process app; credentials
        # for OTLP export come from ag.init(), not this request.
        request.state.auth = {"credentials": _CREDENTIALS[0]}
        return await call_next(request)

    route("/", app=app)(handler)
    return TestClient(app)


_CREDENTIALS = [None]  # set by the fixture below


@pytest.fixture
def routed(agenta_init, api_credentials):
    host, api_key = api_credentials
    _CREDENTIALS[0] = f"ApiKey {api_key}"
    yield
    _CREDENTIALS[0] = None


def _invoke(client, *, accept=None, fmt=None, history=None, traceparent=None):
    headers = {}
    if accept is not None:
        headers["accept"] = accept
    if fmt is not None:
        headers["x-ag-messages-format"] = fmt
    if history is not None:
        headers["x-ag-messages-history"] = history
    if traceparent is not None:
        headers["traceparent"] = traceparent
    return client.post(
        "/invoke", json={"data": {"inputs": {"value": "a"}}}, headers=headers
    )


# =========================================================================== #
# Per-shape trace structure + content (batch shapes; json Accept)
# =========================================================================== #
@pytest.mark.parametrize(
    "shape,is_async",
    [("sync", False), ("async", True)],
)
def test_routed_batch_shape_trace(routed, shape, is_async):
    if is_async:

        async def wf(value: str = "x"):
            return f"{shape}:{value}"

    else:

        def wf(value: str = "x"):
            return f"{shape}:{value}"

    resp = _invoke(_client(wf), accept="application/json")
    assert resp.status_code == 200

    trace_id = resp.headers.get("x-ag-trace-id")
    assert trace_id, "route must surface x-ag-trace-id"

    fetched = _poll_trace(trace_id)
    assert fetched and fetched.trace is not None and fetched.trace.spans

    root = _root_span(fetched.trace)
    assert root is not None
    assert root.span_name == "wf"
    assert root.parent_id is None

    agtree = _ag(root)
    assert agtree.get("type", {}).get("node") == "workflow"
    assert agtree.get("data", {}).get("inputs", {}).get("value") == "a"
    assert agtree.get("data", {}).get("outputs", {}).get("__default__") == f"{shape}:a"


# =========================================================================== #
# Stream shapes — trace identical whether streamed (sse) or aggregated (json)
# =========================================================================== #
@pytest.mark.parametrize("is_async", [False, True])
def test_routed_stream_shape_trace(routed, is_async):
    if is_async:

        async def wf(value: str = "x"):
            yield "one"
            yield "two"

    else:

        def wf(value: str = "x"):
            yield "one"
            yield "two"

    # stream Accept -> a real SSE stream; consume it so the generator span closes.
    resp = _invoke(_client(wf), accept="text/event-stream")
    assert resp.status_code == 200
    _ = resp.text  # drain

    trace_id = resp.headers.get("x-ag-trace-id")
    assert trace_id
    fetched = _poll_trace(trace_id)
    root = _root_span(fetched.trace)
    assert root.span_name == "wf"
    agtree = _ag(root)
    assert agtree.get("type", {}).get("node") == "workflow"
    # all-str chunks join into one output string (instrument generator wrapper).
    assert agtree.get("data", {}).get("outputs", {}).get("__default__") == "onetwo"


# =========================================================================== #
# Negotiation INVARIANCE — same tree across format / history
# =========================================================================== #
def test_routed_trace_invariant_across_format_and_history(routed):
    def wf(value: str = "x"):
        return {"messages": [{"role": "assistant", "content": f"reply:{value}"}]}

    def _tree_signature(trace_id):
        fetched = _poll_trace(trace_id)
        root = _root_span(fetched.trace)
        agtree = _ag(root)
        return (
            root.span_name,
            root.parent_id,
            agtree.get("type", {}).get("node"),
            agtree.get("data", {}).get("inputs", {}).get("value"),
        )

    r_plain = _invoke(_client(wf), accept="application/json")
    r_vercel = _invoke(_client(wf), accept="application/json", fmt="vercel")
    r_history = _invoke(_client(wf), accept="application/json", history="full")

    for r in (r_plain, r_vercel, r_history):
        assert r.status_code == 200

    sig_plain = _tree_signature(r_plain.headers["x-ag-trace-id"])
    sig_vercel = _tree_signature(r_vercel.headers["x-ag-trace-id"])
    sig_history = _tree_signature(r_history.headers["x-ag-trace-id"])

    # The negotiations changed the RESPONSE (projection / trim) but NOT the span tree.
    assert sig_plain == sig_vercel == sig_history
    assert sig_plain[0] == "wf" and sig_plain[2] == "workflow"


# =========================================================================== #
# W3C context propagation — inbound traceparent becomes the remote parent
# =========================================================================== #
def test_routed_trace_honors_inbound_traceparent(routed):
    from uuid import uuid4

    remote_trace_id = uuid4().hex  # 32 hex
    remote_span_id = uuid4().hex[:16]  # 16 hex
    traceparent = f"00-{remote_trace_id}-{remote_span_id}-01"

    def wf(value: str = "x"):
        return f"sync:{value}"

    resp = _invoke(_client(wf), accept="application/json", traceparent=traceparent)
    assert resp.status_code == 200

    # The response trace id must continue the inbound trace id.
    out_trace_id = (resp.headers.get("x-ag-trace-id") or "").replace("-", "")
    assert out_trace_id == remote_trace_id, "root span must share the inbound trace id"

    fetched = _poll_trace(out_trace_id)
    root = _root_span(fetched.trace)
    assert root is not None
    # The root workflow span is a CHILD of the remote span (its parent is the
    # inbound span id), so within this trace the workflow span has a parent.
    parent = (getattr(root, "parent_id", None) or "").replace("-", "")
    assert parent[:16] == remote_span_id[:16]


# =========================================================================== #
# Faithful big-agents `/invoke` shapes — drive the real mock_v0 behaviors so the
# wire is genuine AGENTA MESSAGES (batch) and AGENTA EVENTS (stream), and assert
# the TRACE captured those shapes (not ad-hoc dummies).
# =========================================================================== #
from agenta.sdk.workflows.handlers import _mock_messages, _mock_events  # noqa: E402


def test_routed_agent_messages_batch_trace(routed):
    # batch: the canonical {messages:[{role,content}]} agent envelope.
    def wf(value: str = "x"):
        return _mock_messages(text=f"reply:{value}")

    resp = _invoke(_client(wf), accept="application/json")
    assert resp.status_code == 200
    # response carries the agenta messages envelope
    assert resp.json()["data"]["outputs"]["messages"][-1]["content"] == "reply:a"

    fetched = _poll_trace(resp.headers["x-ag-trace-id"])
    root = _root_span(fetched.trace)
    agtree = _ag(root)
    assert agtree.get("type", {}).get("node") == "workflow"
    # the trace captured the messages envelope under ag.data.outputs.messages
    out = agtree.get("data", {}).get("outputs", {})
    msgs = out.get("messages")
    assert isinstance(msgs, list) and msgs[-1]["content"] == "reply:a"


def test_routed_agent_events_stream_trace(routed):
    # stream: the live agenta event stream {type, data} (mock_v0 `events`).
    async def wf(value: str = "x"):
        async for ev in _mock_events(text=f"reply {value}"):
            yield ev

    resp = _invoke(_client(wf), accept="text/event-stream")
    assert resp.status_code == 200
    body = resp.text
    # plain agenta SSE frames the raw {type, data} events (no vercel projection).
    assert "message_start" in body and "done" in body

    fetched = _poll_trace(resp.headers["x-ag-trace-id"])
    root = _root_span(fetched.trace)
    agtree = _ag(root)
    assert agtree.get("type", {}).get("node") == "workflow"
    # the generator span captured the drained event list as its output.
    out = agtree.get("data", {}).get("outputs", {})
    assert out, "stream span must capture the aggregated event output"


def test_routed_agent_events_vercel_projection(routed):
    # stream + vercel: routing projects agenta events -> Vercel UI message stream.
    async def wf(value: str = "x"):
        async for ev in _mock_events(text=f"reply {value}"):
            yield ev

    resp = _invoke(_client(wf), accept="text/event-stream", fmt="vercel")
    assert resp.status_code == 200
    assert resp.headers.get("x-ag-messages-format") == "vercel"
    body = resp.text
    # vercel UI message stream: text-start/-delta parts + the [DONE] terminator.
    assert "text-delta" in body or "text-start" in body
    assert "[DONE]" in body
    # the TRACE is unchanged by the wire projection — still a workflow root span.
    fetched = _poll_trace(resp.headers["x-ag-trace-id"])
    root = _root_span(fetched.trace)
    assert _ag(root).get("type", {}).get("node") == "workflow"
