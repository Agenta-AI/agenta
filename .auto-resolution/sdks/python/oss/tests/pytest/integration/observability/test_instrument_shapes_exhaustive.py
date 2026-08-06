"""
EXHAUSTIVE instrument matrix at the PROGRAMMATIC layer (`@ag.workflow()` -> real OTel
spans via the in-memory exporter). Every handler SHAPE × every OUTCOME, plus the
cross-cutting properties the returned-generator fix has to preserve:

  SHAPES (6):
    sync-fn          def -> value
    async-fn         async def -> value
    sync-gen         def -> yield            (generator function)
    async-gen        async def -> yield      (async generator function)
    sync-ret-gen     def -> return gen()     (returns a generator; body has no yield)
    async-ret-gen    async def -> return gen()

  OUTCOMES (3):
    success          normal completion
    raise-early      raises before producing anything (batch) / before first yield (stream)
    raise-mid        (streams only) raises after yielding some items

  PROPERTIES asserted:
    - span exists, named after handler, is the workflow root, correct status (OK/ERROR)
    - outputs record DRAINED CONTENT, never a "<generator object ...>" repr (the bug)
    - inputs recorded
    - exception recorded on the span (raise cases)
    - nesting: a nested @instrument() task created DURING execution/iteration parents
      under the workflow root
    - no leakage: a span created AFTER invoke() returns (before/without draining) is NOT
      a child of the workflow span (the context-leak the manual-span approach caused)
    - concurrency: interleaved runs keep their own trees (per-task context isolation)

Uses the in-memory exporter (no backend). Companion to
test_returned_generator_instrument.py (the focused red/green for the bug) and
test_workflow_instrument_programmatic.py (the original per-shape happy path).
"""

import asyncio
import json

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


def _roots(spans):
    return [s for s in spans if s.parent is None]


def _children_of(spans, parent):
    pid = parent.context.span_id
    return [s for s in spans if s.parent and s.parent.span_id == pid]


def _out(span):
    """The recorded output value (decoded if JSON-encoded), or None."""
    raw = span.attributes.get("ag.data.outputs.__default__")
    if isinstance(raw, str) and raw.startswith("@ag.type=json:"):
        return json.loads(raw[len("@ag.type=json:") :])
    return raw


def _no_generator_leaked(span):
    """No attribute value is a generator object's repr."""
    for v in span.attributes.values():
        if isinstance(v, str) and "generator object" in v:
            return False
    return True


# --------------------------------------------------------------------------- #
# Shape builders — each returns a @workflow()-decorated handler producing "onetwo"
# (or raising), for a given outcome. Batch shapes ignore raise-mid.
# --------------------------------------------------------------------------- #
def _build(shape: str, outcome: str):
    def _raise():
        raise RuntimeError("boom")

    if shape == "sync-fn":

        @workflow()
        def wf(value: str):
            if outcome == "raise-early":
                _raise()
            return "onetwo"

        return wf

    if shape == "async-fn":

        @workflow()
        async def wf(value: str):
            if outcome == "raise-early":
                _raise()
            return "onetwo"

        return wf

    if shape == "sync-gen":

        @workflow()
        def wf(value: str):
            if outcome == "raise-early":
                _raise()
            yield "one"
            if outcome == "raise-mid":
                _raise()
            yield "two"

        return wf

    if shape == "async-gen":

        @workflow()
        async def wf(value: str):
            if outcome == "raise-early":
                _raise()
            yield "one"
            if outcome == "raise-mid":
                _raise()
            yield "two"

        return wf

    if shape == "sync-ret-gen":

        def _gen():
            yield "one"
            if outcome == "raise-mid":
                _raise()
            yield "two"

        @workflow()
        def wf(value: str):
            if outcome == "raise-early":
                _raise()
            return _gen()

        return wf

    if shape == "async-ret-gen":

        async def _gen():
            yield "one"
            if outcome == "raise-mid":
                _raise()
            yield "two"

        @workflow()
        async def wf(value: str):
            if outcome == "raise-early":
                _raise()
            return _gen()

        return wf

    raise ValueError(shape)  # pragma: no cover


BATCH_SHAPES = ["sync-fn", "async-fn"]
STREAM_SHAPES = ["sync-gen", "async-gen", "sync-ret-gen", "async-ret-gen"]
ALL_SHAPES = BATCH_SHAPES + STREAM_SHAPES


# =========================================================================== #
# SUCCESS — every shape: root span, content recorded, no generator leak
# =========================================================================== #
@pytest.mark.asyncio
@pytest.mark.parametrize("shape", ALL_SHAPES)
async def test_success_records_content_no_leak(in_memory_tracing, shape):
    wf = _build(shape, "success")
    resp = await wf.invoke(request=_request())

    if shape in BATCH_SHAPES:
        assert isinstance(resp, WorkflowServiceBatchResponse)
        assert resp.data.outputs == "onetwo"
    else:
        assert isinstance(resp, WorkflowServiceStreamResponse)
        assert await _collect(resp) == ["one", "two"]

    roots = _roots(in_memory_tracing.finished_spans())
    assert len(roots) == 1
    root = roots[0]
    assert root.name == "wf"
    assert root.kind == SpanKind.SERVER
    assert root.status.status_code in (StatusCode.OK, StatusCode.UNSET)
    assert root.attributes.get("ag.type.node") == "workflow"
    assert root.attributes.get("ag.data.inputs.value") == "x"
    # THE bug: outputs must be the drained content, never a generator repr.
    assert _out(root) == "onetwo"
    assert _no_generator_leaked(root)


# =========================================================================== #
# RAISE EARLY — every shape: span ends ERROR + exception event
# =========================================================================== #
@pytest.mark.asyncio
@pytest.mark.parametrize("shape", ALL_SHAPES)
async def test_raise_early_records_error(in_memory_tracing, shape):
    wf = _build(shape, "raise-early")
    resp = await wf.invoke(request=_request())

    # A generator FUNCTION (yield-based) defers all work to iteration, so an
    # "early" raise surfaces on the consumer. But a returned-generator handler that
    # raises BEFORE the `return` never constructs the generator — the raise happens
    # in the handler body, so the normalizer catches it into a batch error, exactly
    # like a batch handler. So the response shape here is batch for every case
    # EXCEPT the true generator functions (sync-gen / async-gen).
    if shape in ("sync-gen", "async-gen"):
        assert isinstance(resp, WorkflowServiceStreamResponse)
        with pytest.raises(RuntimeError, match="boom"):
            await _collect(resp)
    else:
        assert isinstance(resp, WorkflowServiceBatchResponse)
        assert resp.status is not None and resp.status.code >= 400

    roots = _roots(in_memory_tracing.finished_spans())
    assert len(roots) == 1
    root = roots[0]
    assert root.status.status_code == StatusCode.ERROR
    assert any(e.name == "exception" for e in root.events), "exception event recorded"
    assert _no_generator_leaked(root)


# =========================================================================== #
# RAISE MID-STREAM — stream shapes only: partial output, ERROR status
# =========================================================================== #
@pytest.mark.asyncio
@pytest.mark.parametrize("shape", STREAM_SHAPES)
async def test_raise_mid_stream_records_error(in_memory_tracing, shape):
    wf = _build(shape, "raise-mid")
    resp = await wf.invoke(request=_request())
    assert isinstance(resp, WorkflowServiceStreamResponse)

    collected = []
    with pytest.raises(RuntimeError, match="boom"):
        async for item in resp.iterator():
            collected.append(item)
    assert collected == ["one"]  # got the pre-error item

    root = _roots(in_memory_tracing.finished_spans())[0]
    assert root.status.status_code == StatusCode.ERROR
    assert _no_generator_leaked(root)


# =========================================================================== #
# NESTING — a nested @instrument() task parents under the workflow root, for
# EVERY shape (created during the call for batch, during iteration for streams).
# =========================================================================== #
@pytest.mark.asyncio
@pytest.mark.parametrize("shape", ALL_SHAPES)
async def test_nested_task_parents_under_root(in_memory_tracing, shape):
    @instrument()
    def child(x: str):
        return f"c:{x}"

    # Build a shape whose body/stream calls child() so a nested span is created
    # while the workflow span must be current.
    if shape == "sync-fn":

        @workflow()
        def wf(value: str):
            child("a")
            return "onetwo"

    elif shape == "async-fn":

        @workflow()
        async def wf(value: str):
            child("a")
            return "onetwo"

    elif shape == "sync-gen":

        @workflow()
        def wf(value: str):
            child("a")
            yield "one"
            yield "two"

    elif shape == "async-gen":

        @workflow()
        async def wf(value: str):
            child("a")
            yield "one"
            yield "two"

    elif shape == "sync-ret-gen":

        def _gen():
            child("a")
            yield "one"
            yield "two"

        @workflow()
        def wf(value: str):
            return _gen()

    else:  # async-ret-gen

        async def _gen():
            child("a")
            yield "one"
            yield "two"

        @workflow()
        async def wf(value: str):
            return _gen()

    resp = await wf.invoke(request=_request())
    if shape not in BATCH_SHAPES:
        await _collect(resp)

    spans = in_memory_tracing.finished_spans()
    root = _roots(spans)[0]
    assert root.name == "wf"
    kids = _children_of(spans, root)
    assert [k.name for k in kids] == ["child"], (
        f"nested task must parent under the workflow root for shape {shape}; "
        f"got children {[k.name for k in kids]}"
    )
    assert kids[0].context.trace_id == root.context.trace_id


# =========================================================================== #
# NO LEAKAGE — a span created AFTER invoke() returns (stream not yet drained)
# must NOT become a child of the workflow span. This is the context-leak the
# manual start_as_current_span hand-off caused; only returned-gen shapes can
# exhibit it (their span is created at invoke() time but consumed later).
# =========================================================================== #
@pytest.mark.asyncio
@pytest.mark.parametrize(
    "shape", ["sync-ret-gen", "async-ret-gen", "sync-gen", "async-gen"]
)
async def test_no_span_leak_after_invoke(in_memory_tracing, shape):
    wf = _build(shape, "success")
    resp = await wf.invoke(request=_request())  # stream wrapper; nothing drained yet

    # Create an unrelated span in the caller's context, BEFORE draining.
    with in_memory_tracing.tracer.start_as_current_span("outsider"):
        pass

    await _collect(resp)  # now drain

    spans = in_memory_tracing.finished_spans()
    outsider = next(s for s in spans if s.name == "outsider")
    assert outsider.parent is None, (
        "a span created after invoke() must NOT leak under the workflow span "
        f"(shape {shape}); the returned-gen span stayed current in the caller task"
    )


# =========================================================================== #
# CONCURRENCY — interleaved runs keep independent trees (per-task isolation).
# =========================================================================== #
@pytest.mark.asyncio
@pytest.mark.parametrize("shape", ["async-gen", "async-ret-gen", "async-fn"])
async def test_concurrent_runs_are_isolated(in_memory_tracing, shape):
    @instrument()
    def mark(tag: str):
        return tag

    if shape == "async-fn":

        @workflow()
        async def wf(value: str):
            mark(value)
            return value

    elif shape == "async-gen":

        @workflow()
        async def wf(value: str):
            mark(value)
            yield value

    else:  # async-ret-gen

        async def _gen(value):
            mark(value)
            yield value

        @workflow()
        async def wf(value: str):
            return _gen(value)

    async def run(tag):
        r = await wf.invoke(request=_request(tag))
        if isinstance(r, WorkflowServiceStreamResponse):
            await _collect(r)

    await asyncio.gather(run("A"), run("B"), run("C"))

    spans = in_memory_tracing.finished_spans()
    roots = _roots(spans)
    assert len(roots) == 3, f"expected 3 independent roots, got {len(roots)}"
    for root in roots:
        kids = _children_of(spans, root)
        assert len(kids) == 1, f"each root has exactly its own 1 child, got {len(kids)}"
        # child shares its own root's trace, not another run's
        assert kids[0].context.trace_id == root.context.trace_id
