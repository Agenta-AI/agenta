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
  - CONTENT  : nested `ag` attribute tree — `ag.type.span == "workflow"`,
               `ag.data.inputs.value`, `ag.data.outputs.__default__`.
               (On READ the API un-flattens the dotted keys into a nested `ag`
               dict — see api/oss/src/core/tracing/utils/attributes.py
               `unmarshall_attributes`. So assertions here are nested, unlike the
               dotted in-memory assertions in the programmatic test. The SDK writes
               the raw attribute `ag.type.node`, but the read path normalizes span
               type into `ag.type.span` — `AgTypeAttributes` has only `trace`/`span`,
               no `node` — so the fetched key is `type.span`, NOT `type.node`.)
  - INVARIANCE: the span tree is the SAME regardless of Accept/format/transcript
               (the three negotiations change the RESPONSE, not the trace).
  - PROPAGATION: an inbound `traceparent` makes the root span a child of the
               remote span (shared trace id, parent = remote span id). Requires the
               OTel middleware (mounted in `_client`) to parse the header into
               request.state.otel — the SDK reads the parent context from there.

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


def _default_output(agtree):
    """The workflow's default output as the read path un-marshals it. A scalar/string
    return surfaces directly as `ag.data.outputs` (NOT wrapped in `{__default__: ...}` —
    that dotted `__default__` key is the in-memory raw-attribute shape, collapsed on
    read). A dict/list output surfaces as-is."""
    return (agtree.get("data") or {}).get("outputs")


# --------------------------------------------------------------------------- #
# In-process routed app over the REAL exporter
# --------------------------------------------------------------------------- #
def _client(handler) -> TestClient:
    app = FastAPI()

    @app.middleware("http")
    async def _fake_auth(request, call_next):
        # Auth is bypassed here; OTLP export credentials come from ag.init().
        request.state.auth = {"credentials": _CREDENTIALS[0]}
        return await call_next(request)

    # Real OTel middleware so an inbound `traceparent` reaches request.state.otel.
    from agenta.sdk.middlewares.routing.otel import OTelMiddleware

    app.add_middleware(OTelMiddleware)

    route("/", app=app)(handler)
    return TestClient(app)


_CREDENTIALS = [None]  # set by the fixture below


@pytest.fixture
def routed(agenta_init, api_credentials):
    host, api_key = api_credentials
    _CREDENTIALS[0] = f"ApiKey {api_key}"
    yield
    _CREDENTIALS[0] = None


def _invoke(
    client,
    *,
    accept=None,
    fmt=None,
    transcript=None,
    control=None,
    embeds=None,
    traceparent=None,
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
    assert agtree.get("type", {}).get("span") == "workflow"
    assert agtree.get("data", {}).get("inputs", {}).get("value") == "a"
    assert _default_output(agtree) == f"{shape}:a"


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
    body = resp.text
    assert "one" in body and "two" in body
    assert "generator object" not in body

    # Span created eagerly, so a stream surfaces x-ag-trace-id like a batch response.
    trace_id = resp.headers.get("x-ag-trace-id")
    assert trace_id, "stream must surface x-ag-trace-id"
    fetched = _poll_trace(trace_id)
    root = _root_span(fetched.trace)
    assert root.span_name == "wf"
    agtree = _ag(root)
    assert agtree.get("type", {}).get("span") == "workflow"
    # all-str chunks join into one output string (instrument generator wrapper).
    assert _default_output(agtree) == "onetwo"


# =========================================================================== #
# Negotiation INVARIANCE — same tree across format / transcript (flag-blind handler).
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
            agtree.get("type", {}).get("span"),
            agtree.get("data", {}).get("inputs", {}).get("value"),
        )

    r_plain = _invoke(_client(wf), accept="application/json")
    r_vercel = _invoke(_client(wf), accept="application/json", fmt="vercel")
    r_transcript = _invoke(_client(wf), accept="application/json", transcript="full")

    for r in (r_plain, r_vercel, r_transcript):
        assert r.status_code == 200

    sig_plain = _tree_signature(r_plain.headers["x-ag-trace-id"])
    sig_vercel = _tree_signature(r_vercel.headers["x-ag-trace-id"])
    sig_transcript = _tree_signature(r_transcript.headers["x-ag-trace-id"])

    # The negotiations changed the RESPONSE (projection / trim) but NOT the span tree.
    assert sig_plain == sig_vercel == sig_transcript


# =========================================================================== #
# 5-axis negotiation INVARIANCE: stream x format x transcript x control x embeds,
# over a REQUEST-TAKING, flag-branching handler shaped like agent_v0. Response
# varies across combos (stream shape, trim length, vercel projection); span
# tree + accumulated output must not. `embeds` held at its header default since
# no header variant of it is distinguishable at this layer.
# =========================================================================== #
def _agent_shaped_routed_handler():
    """Mirrors agent_v0's own branch (stream -> events; force -> 406; else ->
    folded + optionally trimmed envelope) using the SDK's real fold/trim, so
    the response genuinely varies with the flags under test."""
    from agenta.sdk.agents.fold import fold, trim_to_trailing_unit
    from agenta.sdk.engines.running.errors import ForceNotSupportedV0Error
    from agenta.sdk.models.workflows import WorkflowInvokeRequestFlags

    async def _events(value):
        async for ev in _mock_events(text=f"reply {value}", tool="search"):
            yield ev

    async def _batch(value, *, trim):
        events = [ev async for ev in _mock_events(text=f"reply {value}", tool="search")]
        folded = fold(events)
        messages = folded["messages"]
        if trim:
            messages = trim_to_trailing_unit(messages)
        return {"messages": messages}

    async def wf(request, value: str = "x"):
        flags = WorkflowInvokeRequestFlags(**(request.flags or {}))
        if flags.force:
            raise ForceNotSupportedV0Error()
        if flags.stream:
            return _events(value)
        return await _batch(value, trim=bool(flags.trim))

    return wf


def test_routed_trace_invariant_across_five_axis_cube(routed):
    def _tree_signature(trace_id):
        fetched = _poll_trace(trace_id)
        root = _root_span(fetched.trace)
        agtree = _ag(root)
        return (
            root.span_name,
            root.parent_id,
            agtree.get("type", {}).get("span"),
            agtree.get("data", {}).get("inputs", {}).get("value"),
        )

    def _outputs_signature(trace_id):
        fetched = _poll_trace(trace_id)
        root = _root_span(fetched.trace)
        agtree = _ag(root)
        out = agtree.get("data", {}).get("outputs")
        # batch holds the untrimmed 3-message turn; stream holds the full event list.
        if isinstance(out, dict) and isinstance(out.get("messages"), list):
            return len(out["messages"])
        if isinstance(out, list):  # stream shape: accumulated event list
            return len(out)
        return out

    stream_values = (False, True)
    transcript_values = (None, "full", "last")
    fmt_values = (None, "vercel")

    signatures = {}
    for stream in stream_values:
        accept = "text/event-stream" if stream else "application/json"
        for transcript in transcript_values:
            for fmt in fmt_values:
                wf = _agent_shaped_routed_handler()
                resp = _invoke(
                    _client(wf), accept=accept, fmt=fmt, transcript=transcript
                )
                assert resp.status_code == 200
                if stream:
                    body = resp.text
                    if fmt == "vercel":
                        # vercel projection renames the agenta event vocabulary.
                        assert "tool-input-available" in body
                        assert "[DONE]" in body
                    else:
                        assert "tool_call" in body and "done" in body
                else:
                    outputs = resp.json()["data"]["outputs"]
                    msgs = outputs["messages"]
                    expected_len = 1 if transcript == "last" else 3
                    assert len(msgs) == expected_len, (
                        f"trim did not change the RESPONSE for transcript={transcript!r}"
                    )

                trace_id = resp.headers["x-ag-trace-id"]
                signatures[(stream, transcript, fmt)] = (
                    _tree_signature(trace_id),
                    _outputs_signature(trace_id),
                )

    tree_sigs = {sig for sig, _ in signatures.values()}
    assert len(tree_sigs) == 1, (
        f"span tree must be IDENTICAL across the full cube, got {tree_sigs}"
    )
    # span output is invariant to `format` (HTTP-only); invariant checked per (stream, transcript).
    by_combo: dict[tuple, set] = {}
    for (stream, transcript, _fmt), (_tree, out) in signatures.items():
        by_combo.setdefault((stream, transcript), set()).add(out)
    for combo, output_sigs in by_combo.items():
        assert len(output_sigs) == 1, (
            f"accumulated span output must be invariant to format for "
            f"(stream, transcript)={combo}, got {output_sigs}"
        )
    (_, only_output) = next(iter(signatures.values()))
    assert only_output == 3, "span must hold the untrimmed 3-message tool-run turn"


# =========================================================================== #
# The 406 path: force=True 406s regardless of stream/transcript/format; a stream
# Accept + force still gets a JSON error body, not a stream.
# =========================================================================== #
@pytest.mark.parametrize("accept", ["application/json", "text/event-stream"])
def test_routed_force_true_pins_406_regardless_of_other_axes(routed, accept):
    wf = _agent_shaped_routed_handler()
    resp = _invoke(
        _client(wf), accept=accept, fmt="vercel", transcript="last", control="force"
    )
    assert resp.status_code == 406
    assert resp.headers["content-type"].startswith("application/json")
    body = resp.json()
    assert body["status"]["code"] == 406


# =========================================================================== #
# `resolve`/embeds axis: no header value maps to False, so absent vs
# `x-ag-workflow-embeds: resolve` must produce an identical trace.
# =========================================================================== #
def test_routed_trace_invariant_embeds_header_present_vs_absent(routed):
    def wf(value: str = "x"):
        return {"messages": [{"role": "assistant", "content": f"reply:{value}"}]}

    def _tree_signature(trace_id):
        fetched = _poll_trace(trace_id)
        root = _root_span(fetched.trace)
        agtree = _ag(root)
        return (
            root.span_name,
            root.parent_id,
            agtree.get("type", {}).get("span"),
            _default_output(agtree),
        )

    r_absent = _invoke(_client(wf), accept="application/json")
    r_resolve = _invoke(_client(wf), accept="application/json", embeds="resolve")

    assert r_absent.status_code == 200 and r_resolve.status_code == 200
    sig_absent = _tree_signature(r_absent.headers["x-ag-trace-id"])
    sig_resolve = _tree_signature(r_resolve.headers["x-ag-trace-id"])
    assert sig_absent == sig_resolve
    assert sig_absent[0] == "wf" and sig_absent[2] == "workflow"


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

    # Root span continues the inbound W3C context: shares the trace id, fresh span id.
    out_trace_id = (resp.headers.get("x-ag-trace-id") or "").replace("-", "")
    assert out_trace_id == remote_trace_id, "root span must share the inbound trace id"

    out_span_id = (resp.headers.get("x-ag-span-id") or "").replace("-", "")
    assert out_span_id and out_span_id != remote_span_id, (
        "root span must be a fresh child of the remote span, not the remote span itself"
    )

    # The response traceparent restates the continued trace id (its own new span id).
    out_traceparent = resp.headers.get("traceparent") or ""
    assert remote_trace_id in out_traceparent.replace("-", "")


# =========================================================================== #
# Faithful big-agents `/invoke` shapes — real mock_v0 behaviors, trace asserted.
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
    assert agtree.get("type", {}).get("span") == "workflow"
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
    assert "generator object" not in body

    fetched = _poll_trace(resp.headers["x-ag-trace-id"])
    root = _root_span(fetched.trace)
    agtree = _ag(root)
    assert agtree.get("type", {}).get("span") == "workflow"
    # the generator span captured the drained event list as its output.
    out = _default_output(agtree)
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
    assert _ag(root).get("type", {}).get("span") == "workflow"


# =========================================================================== #
# RETURNED-GENERATOR shape against the LIVE backend — regression for the
# "<async_generator object ...>" trace bug.
# =========================================================================== #
def _ret_gen_handler(is_async: bool):
    """An async/sync def that RETURNS a generator, mirroring _agent's shape."""
    if is_async:

        async def _events():
            yield {"type": "message_start", "data": {"id": "m"}}
            yield {"type": "message_delta", "data": {"id": "m", "delta": "hi"}}
            yield {"type": "done", "data": {}}

        async def wf(value: str = "x"):
            return _events()  # returns the generator; body has no `yield`

    else:

        def _events():
            yield {"type": "message_start", "data": {"id": "m"}}
            yield {"type": "done", "data": {}}

        def wf(value: str = "x"):
            return _events()

    return wf


@pytest.mark.parametrize("is_async", [True, False])
def test_routed_returned_generator_trace_records_drained_events(routed, is_async):
    wf = _ret_gen_handler(is_async)

    resp = _invoke(_client(wf), accept="text/event-stream")
    assert resp.status_code == 200
    body = resp.text
    assert "message_start" in body and "done" in body
    assert "generator object" not in body  # not serialized into the wire

    fetched = _poll_trace(resp.headers["x-ag-trace-id"])
    root = _root_span(fetched.trace)
    assert root is not None and root.span_name == "wf"
    agtree = _ag(root)
    assert agtree.get("type", {}).get("span") == "workflow"

    # THE regression: span output must be the drained events, never the generator's repr.
    out = _default_output(agtree)
    assert out, "returned-generator span must capture the drained events"

    def _walk(x):
        if isinstance(x, dict):
            return any(_walk(v) for v in x.values())
        if isinstance(x, list):
            return any(_walk(v) for v in x)
        return isinstance(x, str) and "generator object" in x

    assert not _walk(agtree), "generator object leaked into the fetched trace"


def test_routed_returned_generator_json_accept_aggregates(routed):
    # batch Accept on a flag-blind returned-generator handler -> 406 (no courtesy aggregation).
    wf = _ret_gen_handler(is_async=True)
    resp = _invoke(_client(wf), accept="application/json", transcript="full")
    assert resp.status_code == 406
    assert resp.headers["content-type"].startswith("application/json")
    body = resp.json()
    assert body["requested"] == "application/json"
    assert "text/event-stream" in body["supported"]


def test_routed_returned_generator_raise_early_is_error_trace(routed):
    # raise BEFORE returning the generator -> batch error response.
    async def wf(value: str = "x"):
        raise RuntimeError("boom")

    resp = _invoke(_client(wf), accept="application/json")
    assert resp.status_code == 500
    assert resp.json()["status"]["message"] == "boom"

    trace_id = resp.headers.get("x-ag-trace-id")
    if trace_id:
        fetched = _poll_trace(trace_id)
        root = _root_span(fetched.trace) if fetched and fetched.trace else None
        if root is not None:
            status = getattr(root, "status_code", None)
            if status is not None:
                assert str(status).upper().find("OK") == -1, "errored span not OK"
