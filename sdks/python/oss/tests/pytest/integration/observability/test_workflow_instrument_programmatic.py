"""
PROGRAMMATIC layer: `@ag.workflow()` auto-instrumentation across the four handler
shapes, asserting the EMITTED TRACE (structure + content), not just the response.

This is the lowest real altitude: a user runs a workflow in code. `@ag.workflow()`
registers the handler through `auto_instrument(...)`, so a real OTel span is opened per
invoke. We capture those spans with an in-memory exporter (see conftest) and assert:

  - STRUCTURE: one root span, named after the handler, no parent, SpanKind SERVER, OK.
  - CONTENT : `ag.type.node == "workflow"` (root promotion), `ag.data.inputs.<arg>`,
              `ag.data.outputs.__default__`, `ag.meta.configuration` on root.
  - NESTING : an inner `@ag.instrument()` task → child span, `type=task`, parent=root.
  - ERRORS  : a raising handler → span status ERROR + recorded exception.
  - USAGE   : a `{message,cost,usage}` return → `ag.metrics.unit.{tokens,costs}`.
  - REDACT  : `ignore_inputs` / `ignore_outputs` drop the field from `ag.data.*`.

The four shapes (response behavior is covered by unit/test_workflow_shapes_running.py;
here we cover the TRACE for each):

    1. sync  def  -> value          (batch)   2. async def  -> value          (batch)
    3. sync  def  -> yield          (stream)  4. async def  -> yield          (stream)

Marked `integration` (real OTel SDK wiring) but needs NO backend — spans are captured
in process. Trace assertions over a routed `/invoke` against a live backend live in
acceptance/observability/test_workflow_instrument_routed.py.

Attribute key shape: the SDK marshals to flat dotted keys (`ag.data.inputs.value`)
BEFORE export, so the in-memory span carries dotted keys. (The traces API later
UN-flattens these into a nested `ag` dict on read — that nested form is what the routed
acceptance tests assert. Same data, different surface.)
"""

import pytest

from agenta.sdk.decorators.running import workflow
from agenta.sdk.decorators.tracing import instrument
from agenta.sdk.models.workflows import (
    WorkflowServiceRequest,
    WorkflowServiceBatchResponse,
    WorkflowServiceStreamResponse,
)

from opentelemetry.trace import SpanKind, StatusCode


pytestmark = [pytest.mark.integration, pytest.mark.speed_fast]


# --------------------------------------------------------------------------- #
# helpers
# --------------------------------------------------------------------------- #
def _request(value: str = "x") -> WorkflowServiceRequest:
    return WorkflowServiceRequest(data={"inputs": {"value": value}})


async def _collect(stream_response) -> list:
    return [item async for item in stream_response.iterator()]


def _attr(span, dotted_key: str):
    """Read a marshalled attribute off a captured ReadableSpan."""
    return span.attributes.get(dotted_key)


def _json_attr(span, dotted_key: str):
    """Decode a `@ag.type=json:` attribute value into its Python object.

    At the default max_depth=2, a nested value (a messages list / event list) is
    stored as one JSON-encoded string under the truncated key rather than as
    dotted leaves. This decodes it back for content assertions.
    """
    import json

    raw = span.attributes.get(dotted_key)
    if isinstance(raw, str) and raw.startswith("@ag.type=json:"):
        return json.loads(raw[len("@ag.type=json:") :])
    return raw


def _roots(spans):
    return [s for s in spans if s.parent is None]


def _children_of(spans, parent_span):
    pid = parent_span.context.span_id
    return [s for s in spans if s.parent is not None and s.parent.span_id == pid]


def _assert_workflow_root(span, *, name: str):
    """The invariant a root workflow span must satisfy, regardless of shape.

    Note: `ag.meta.configuration` is stamped on the root only when the workflow
    has non-empty `parameters` — an empty config marshals to nothing and the
    serializer drops it. So configuration capture is asserted separately
    (test_configuration_captured_on_root), not in this shape-invariant.
    """
    assert span.name == name
    assert span.parent is None
    assert span.kind == SpanKind.SERVER, "root workflow span is SERVER kind"
    assert _attr(span, "ag.type.node") == "workflow", "root → type promoted to workflow"
    assert span.status.status_code in (StatusCode.OK, StatusCode.UNSET)


# --------------------------------------------------------------------------- #
# Shape 1 — sync def -> value (batch)
# --------------------------------------------------------------------------- #
@pytest.mark.asyncio
async def test_sync_function_trace(in_memory_tracing):
    @workflow()
    def wf(value: str):
        return f"sync:{value}"

    response = await wf.invoke(request=_request("a"))
    assert isinstance(response, WorkflowServiceBatchResponse)
    assert response.data.outputs == "sync:a"

    spans = in_memory_tracing.finished_spans()
    roots = _roots(spans)
    assert len(roots) == 1, f"expected exactly one root span, got {len(roots)}"
    root = roots[0]
    _assert_workflow_root(root, name="wf")
    assert _attr(root, "ag.data.inputs.value") == "a"
    assert _attr(root, "ag.data.outputs.__default__") == "sync:a"


# --------------------------------------------------------------------------- #
# Shape 2 — async def -> value (batch)
# --------------------------------------------------------------------------- #
@pytest.mark.asyncio
async def test_async_function_trace(in_memory_tracing):
    @workflow()
    async def wf(value: str):
        return f"async:{value}"

    response = await wf.invoke(request=_request("b"))
    assert isinstance(response, WorkflowServiceBatchResponse)
    assert response.data.outputs == "async:b"

    root = _roots(in_memory_tracing.finished_spans())
    assert len(root) == 1
    root = root[0]
    _assert_workflow_root(root, name="wf")
    assert _attr(root, "ag.data.inputs.value") == "b"
    assert _attr(root, "ag.data.outputs.__default__") == "async:b"


# --------------------------------------------------------------------------- #
# Shape 3 — sync def -> yield (stream; sync generator)
# --------------------------------------------------------------------------- #
@pytest.mark.asyncio
async def test_sync_generator_trace(in_memory_tracing):
    @workflow()
    def wf(value: str):
        yield "one"
        yield "two"

    response = await wf.invoke(request=_request("c"))
    assert isinstance(response, WorkflowServiceStreamResponse)
    assert await _collect(response) == ["one", "two"]

    # The generator span closes in the wrapper's `finally`, AFTER the iterator is
    # fully drained — so the spans only exist post-collect.
    roots = _roots(in_memory_tracing.finished_spans())
    assert len(roots) == 1
    root = roots[0]
    _assert_workflow_root(root, name="wf")
    # all-str chunks are joined into a single string output (instrument wrapper).
    assert _attr(root, "ag.data.outputs.__default__") == "onetwo"


# --------------------------------------------------------------------------- #
# Shape 4 — async def -> yield (stream; async generator)
# --------------------------------------------------------------------------- #
@pytest.mark.asyncio
async def test_async_generator_trace(in_memory_tracing):
    @workflow()
    async def wf(value: str):
        yield "one"
        yield "two"

    response = await wf.invoke(request=_request("d"))
    assert isinstance(response, WorkflowServiceStreamResponse)
    assert await _collect(response) == ["one", "two"]

    roots = _roots(in_memory_tracing.finished_spans())
    assert len(roots) == 1
    root = roots[0]
    _assert_workflow_root(root, name="wf")
    assert _attr(root, "ag.data.outputs.__default__") == "onetwo"


# --------------------------------------------------------------------------- #
# Nesting — an inner @ag.instrument() task under the workflow root
# --------------------------------------------------------------------------- #
@pytest.mark.asyncio
async def test_nested_task_is_child_of_workflow_root(in_memory_tracing):
    @instrument()  # default type="task"
    def inner(x: str):
        return f"inner:{x}"

    @workflow()
    def wf(value: str):
        return inner(value)

    response = await wf.invoke(request=_request("z"))
    assert isinstance(response, WorkflowServiceBatchResponse)
    assert response.data.outputs == "inner:z"

    spans = in_memory_tracing.finished_spans()
    roots = _roots(spans)
    assert len(roots) == 1
    root = roots[0]
    _assert_workflow_root(root, name="wf")

    children = _children_of(spans, root)
    assert len(children) == 1, "expected exactly one nested task span"
    child = children[0]
    assert child.name == "inner"
    # bare @instrument() records uppercase "TASK", unlike the root's lowercase "workflow".
    assert _attr(child, "ag.type.node") == "TASK"
    assert child.kind == SpanKind.INTERNAL
    assert _attr(child, "ag.data.outputs.__default__") == "inner:z"
    # nested spans do NOT carry the root-only configuration meta.
    assert "ag.meta.configuration" not in child.attributes


# --------------------------------------------------------------------------- #
# Configuration meta on the root (only when parameters are non-empty)
# --------------------------------------------------------------------------- #
@pytest.mark.asyncio
async def test_configuration_captured_on_root(in_memory_tracing):
    @workflow(parameters={"temperature": 0.7, "model": "gpt-x"})
    def wf(value: str, parameters: dict = None):
        return f"sync:{value}"

    await wf.invoke(request=_request("p"))

    root = _roots(in_memory_tracing.finished_spans())[0]
    # configuration marshals to dotted leaves under ag.meta.configuration.*
    assert _attr(root, "ag.meta.configuration.temperature") == pytest.approx(0.7)
    assert _attr(root, "ag.meta.configuration.model") == "gpt-x"


# --------------------------------------------------------------------------- #
# Errors
# --------------------------------------------------------------------------- #
@pytest.mark.asyncio
async def test_raising_function_records_error_status(in_memory_tracing):
    @workflow()
    def wf(value: str):
        raise RuntimeError("boom")

    # span must end with ERROR status + a recorded exception event.
    response = await wf.invoke(request=_request())
    assert isinstance(response, WorkflowServiceBatchResponse)
    assert response.status is not None and response.status.code >= 400

    roots = _roots(in_memory_tracing.finished_spans())
    assert len(roots) == 1
    root = roots[0]
    assert root.name == "wf"
    assert root.status.status_code == StatusCode.ERROR
    assert any(e.name == "exception" for e in root.events), "exception event recorded"


@pytest.mark.asyncio
async def test_async_generator_raising_midstream_records_error(in_memory_tracing):
    @workflow()
    async def wf(value: str):
        yield "first"
        raise RuntimeError("boom mid-stream")

    response = await wf.invoke(request=_request())
    assert isinstance(response, WorkflowServiceStreamResponse)

    collected = []
    with pytest.raises(RuntimeError, match="boom mid-stream"):
        async for item in response.iterator():
            collected.append(item)
    assert collected == ["first"]

    roots = _roots(in_memory_tracing.finished_spans())
    assert len(roots) == 1
    root = roots[0]
    assert root.status.status_code == StatusCode.ERROR


# --------------------------------------------------------------------------- #
# Usage / cost roll-up
# --------------------------------------------------------------------------- #
@pytest.mark.asyncio
async def test_usage_and_cost_metrics_recorded(in_memory_tracing):
    @workflow()
    def wf(value: str):
        return {
            "message": f"hi:{value}",
            "cost": 0.0066,
            "usage": {
                "prompt_tokens": 1297,
                "completion_tokens": 5,
                "total_tokens": 1302,
            },
        }

    await wf.invoke(request=_request("u"))

    root = _roots(in_memory_tracing.finished_spans())[0]
    assert _attr(root, "ag.metrics.unit.costs.total") == pytest.approx(0.0066)
    assert _attr(root, "ag.metrics.unit.tokens.prompt") == pytest.approx(1297)
    assert _attr(root, "ag.metrics.unit.tokens.completion") == pytest.approx(5)
    assert _attr(root, "ag.metrics.unit.tokens.total") == pytest.approx(1302)
    # `_patch`: a {message,cost,usage} dict collapses to its message at __default__.
    assert _attr(root, "ag.data.outputs.__default__") == "hi:u"


# --------------------------------------------------------------------------- #
# Redaction (the content-capture gate)
# --------------------------------------------------------------------------- #
@pytest.mark.asyncio
async def test_ignore_inputs_drops_field_from_trace(in_memory_tracing):
    @workflow()
    @instrument(ignore_inputs=["value"])
    def wf(value: str):
        return f"sync:{value}"

    await wf.invoke(request=_request("secret"))

    root = _roots(in_memory_tracing.finished_spans())[0]
    assert _attr(root, "ag.data.inputs.value") is None, "ignored input must not land"
    # output still captured (only inputs were ignored)
    assert _attr(root, "ag.data.outputs.__default__") == "sync:secret"


@pytest.mark.asyncio
async def test_ignore_outputs_drops_outputs_from_trace(in_memory_tracing):
    @workflow()
    @instrument(ignore_outputs=True)
    def wf(value: str):
        return f"sync:{value}"

    await wf.invoke(request=_request("v"))

    root = _roots(in_memory_tracing.finished_spans())[0]
    assert _attr(root, "ag.data.outputs.__default__") is None
    # inputs still captured
    assert _attr(root, "ag.data.inputs.value") == "v"


# --------------------------------------------------------------------------- #
# Faithful big-agents `/invoke` shapes via the real mock_v0 behaviors.
# --------------------------------------------------------------------------- #
from agenta.sdk.workflows.handlers import _mock_messages, _mock_events  # noqa: E402


@pytest.mark.asyncio
async def test_agent_messages_envelope_trace(in_memory_tracing):
    @workflow()
    def wf(value: str):
        # batch agent shape: {messages:[{role,content}]} (mirrors _agent_batch).
        return _mock_messages(text=f"reply:{value}")

    response = await wf.invoke(request=_request("m"))
    assert isinstance(response, WorkflowServiceBatchResponse)
    assert response.data.outputs["messages"][-1]["content"] == "reply:m"

    root = _roots(in_memory_tracing.finished_spans())[0]
    _assert_workflow_root(root, name="wf")
    # not the {message,cost,usage} shape, so _patch passes it through unchanged.
    msgs = _json_attr(root, "ag.data.outputs.messages")
    assert isinstance(msgs, list)
    assert msgs[-1]["role"] == "assistant" and msgs[-1]["content"] == "reply:m"


@pytest.mark.asyncio
async def test_agent_events_stream_trace(in_memory_tracing):
    @workflow()
    async def wf(value: str):
        # stream agent shape: yield the agenta event stream {type, data}.
        async for ev in _mock_events(text=f"reply {value}"):
            yield ev

    response = await wf.invoke(request=_request("e"))
    assert isinstance(response, WorkflowServiceStreamResponse)
    events = await _collect(response)
    types = [e["type"] for e in events]
    assert types[0] == "message_start" and types[-1] == "done"

    root = _roots(in_memory_tracing.finished_spans())[0]
    _assert_workflow_root(root, name="wf")
    # dict chunks are not joined; captured as a JSON-encoded list.
    captured = _json_attr(root, "ag.data.outputs.__default__")
    assert isinstance(captured, list)
    assert captured[0]["type"] == "message_start"
    assert captured[-1]["type"] == "done"


# --------------------------------------------------------------------------- #
# 5-axis negotiation INVARIANCE: stream x format x transcript x control x embeds.
# `format` is HTTP-only and exercised at the routed layer instead; programmatically
# the remaining axes collapse to stream/trim/force/resolve booleans, swept in full.
# --------------------------------------------------------------------------- #
from agenta.sdk.agents.fold import fold, trim_to_trailing_unit  # noqa: E402
from agenta.sdk.engines.running.errors import ForceNotSupportedV0Error  # noqa: E402
from agenta.sdk.models.workflows import WorkflowInvokeRequestFlags  # noqa: E402


def _agent_shaped_request(*, stream=None, trim=None, force=None, resolve=None):
    flags = {}
    if stream is not None:
        flags["stream"] = stream
    if trim is not None:
        flags["trim"] = trim
    if force is not None:
        flags["force"] = force
    if resolve is not None:
        flags["resolve"] = resolve
    return WorkflowServiceRequest(data={"inputs": {"value": "x"}}, flags=flags)


# Split into batch/stream/dispatcher since one `async def` can't both return and yield.
async def _agent_shaped_batch(value: str, *, trim: bool):
    events = [ev async for ev in _mock_events(text=f"reply {value}", tool="search")]
    folded = fold(events)
    messages = folded["messages"]
    if trim:
        messages = trim_to_trailing_unit(messages)
    return {"messages": messages, "stop_reason": folded.get("stop_reason")}


async def _agent_shaped_stream(value: str):
    async for ev in _mock_events(text=f"reply {value}", tool="search"):
        yield ev


def _build_agent_shaped_workflow():
    @workflow()
    async def wf(request, value: str):
        flags = WorkflowInvokeRequestFlags(**(request.flags or {}))
        if flags.force:
            raise ForceNotSupportedV0Error()
        if flags.stream:
            return _agent_shaped_stream(value)  # generator object, NOT awaited
        return await _agent_shaped_batch(value, trim=bool(flags.trim))

    return wf


_TRI = (None, False, True)


@pytest.mark.parametrize("resolve", _TRI)
@pytest.mark.parametrize("trim", _TRI)
@pytest.mark.parametrize("stream", _TRI)
@pytest.mark.asyncio
async def test_agent_shaped_trace_invariant_across_stream_trim_resolve(
    in_memory_tracing, stream, trim, resolve
):
    """Non-406 corner of the cube: span tree + accumulated outputs identical
    regardless of stream/trim/resolve, even though the RESPONSE demonstrably
    varies (stream flips shape; trim drops the tool-call/tool-result pair)."""
    wf = _build_agent_shaped_workflow()
    request = _agent_shaped_request(
        stream=stream, trim=trim, force=None, resolve=resolve
    )
    response = await wf.invoke(request=request)

    if stream:
        assert isinstance(response, WorkflowServiceStreamResponse)
        events = await _collect(response)
        # tool="search" makes tool_call the first event; done is always terminal.
        assert events[0]["type"] == "tool_call" and events[-1]["type"] == "done"
    else:
        assert isinstance(response, WorkflowServiceBatchResponse)
        messages = response.data.outputs["messages"]
        if trim:
            assert messages == [{"role": "assistant", "content": "reply x "}]
        else:
            assert len(messages) == 3  # tool_call + tool_result + assistant

    roots = _roots(in_memory_tracing.finished_spans())
    assert len(roots) == 1, f"expected exactly one root span, got {len(roots)}"
    root = roots[0]
    _assert_workflow_root(root, name="wf")

    # ACCUMULATED OUTPUT invariance: span always captures the full, untrimmed turn.
    if stream:
        captured = _json_attr(root, "ag.data.outputs.__default__")
        assert isinstance(captured, list) and len(captured) >= 5
        assert captured[0]["type"] == "tool_call"
        assert captured[-1]["type"] == "done"
    else:
        msgs = _json_attr(root, "ag.data.outputs.messages")
        # span output equals whatever the handler returned (trim applied inside it).
        if trim:
            assert msgs == [{"role": "assistant", "content": "reply x "}]
        else:
            assert len(msgs) == 3


@pytest.mark.parametrize("resolve", _TRI)
@pytest.mark.parametrize("trim", _TRI)
@pytest.mark.parametrize("stream", _TRI)
@pytest.mark.asyncio
async def test_agent_shaped_resolve_never_alters_trace_for_fixed_stream_trim(
    in_memory_tracing, stream, trim, resolve
):
    """Isolate `resolve` (middleware-owned, stripped pre-handler): holding
    stream/trim fixed, the span tree + accumulated outputs must be BYTE-IDENTICAL
    across every `resolve` value (None/False/True) — resolve never reaches the
    handler, so nothing it does can vary with it. Runs the request twice (resolve
    unset vs the given value) and diffs the two span signatures."""

    def _signature(root):
        base = {
            "name": root.name,
            "parent": root.parent,
            "kind": root.kind,
            "status": root.status.status_code,
            "inputs_value": _attr(root, "ag.data.inputs.value"),
        }
        if stream:
            base["outputs"] = _json_attr(root, "ag.data.outputs.__default__")
        else:
            base["outputs"] = _json_attr(root, "ag.data.outputs.messages")
        return base

    wf = _build_agent_shaped_workflow()

    request_a = _agent_shaped_request(stream=stream, trim=trim, resolve=None)
    response_a = await wf.invoke(request=request_a)
    if stream:
        await _collect(response_a)
    root_a = _roots(in_memory_tracing.finished_spans())[-1]
    sig_a = _signature(root_a)

    in_memory_tracing.clear()

    wf2 = _build_agent_shaped_workflow()
    request_b = _agent_shaped_request(stream=stream, trim=trim, resolve=resolve)
    response_b = await wf2.invoke(request=request_b)
    if stream:
        await _collect(response_b)
    root_b = _roots(in_memory_tracing.finished_spans())[-1]
    sig_b = _signature(root_b)

    assert sig_a == sig_b, "resolve must never change the span tree or its outputs"


# --------------------------------------------------------------------------- #
# The 406 path: force=True raises from inside the handler; span records the
# error but never any ag.data.outputs, regardless of stream/trim/resolve.
# --------------------------------------------------------------------------- #
@pytest.mark.parametrize("resolve", _TRI)
@pytest.mark.parametrize("trim", _TRI)
@pytest.mark.parametrize("stream", _TRI)
@pytest.mark.asyncio
async def test_agent_shaped_force_true_pins_406_error_trace(
    in_memory_tracing, stream, trim, resolve
):
    wf = _build_agent_shaped_workflow()
    request = _agent_shaped_request(
        stream=stream, trim=trim, force=True, resolve=resolve
    )
    response = await wf.invoke(request=request)

    # normalizer maps the raised ForceNotSupportedV0Error to a 406 batch response.
    assert isinstance(response, WorkflowServiceBatchResponse)
    assert response.status is not None and response.status.code == 406

    roots = _roots(in_memory_tracing.finished_spans())
    assert len(roots) == 1, f"expected exactly one root span, got {len(roots)}"
    root = roots[0]
    assert root.name == "wf"
    assert root.parent is None
    assert root.status.status_code == StatusCode.ERROR
    assert any(e.name == "exception" for e in root.events), "exception event recorded"
    # no output was ever produced — the handler raised before returning/yielding.
    assert _attr(root, "ag.data.outputs.__default__") is None
    assert _json_attr(root, "ag.data.outputs.messages") is None
