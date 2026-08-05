"""
The "returned generator" shape — an `async def` (or `def`) that RETURNS a generator
object instead of `yield`ing. This is the shape the agent handler `_agent` uses
(`return _agent_event_stream(...)`), and it is valid Python.

The bug (before the fix): `@instrument()` dispatches on the FUNCTION's static shape
(`isasyncgenfunction`), which is False for a coroutine that merely returns a generator.
So it took the batch path, recorded the generator OBJECT's repr as outputs, and closed
the span before the stream was consumed. The trace showed
`<async_generator object ... at 0x...>` instead of the drained content.

The fix (A): the coroutine/sync wrappers detect at RUNTIME that the produced value is a
generator and wrap it so the span stays open across consumption and records the drained
content in its finally — the same contract a `yield`-based handler gets. Both shapes work.

These tests are RED before the fix, GREEN after. Uses the in-memory exporter (no backend).
"""

import pytest

from agenta.sdk.decorators.running import workflow
from agenta.sdk.models.workflows import WorkflowServiceStreamResponse

from oss.tests.pytest.integration.observability.test_workflow_instrument_programmatic import (  # noqa: E501
    _request,
    _collect,
    _json_attr,
    _roots,
    _assert_workflow_root,
    _attr,
)


pytestmark = [pytest.mark.integration, pytest.mark.speed_fast]


# --------------------------------------------------------------------------- #
# ASYNC def that RETURNS an async generator (the agent's shape)
# --------------------------------------------------------------------------- #
@pytest.mark.asyncio
async def test_async_def_returning_async_gen_records_drained_content(in_memory_tracing):
    async def _events():
        yield "one"
        yield "two"

    @workflow()
    async def wf(value: str):
        return _events()  # returns a generator; body has no `yield`

    response = await wf.invoke(request=_request("a"))
    assert isinstance(response, WorkflowServiceStreamResponse)
    assert await _collect(response) == ["one", "two"]

    root = _roots(in_memory_tracing.finished_spans())[0]
    _assert_workflow_root(root, name="wf")
    out = _attr(root, "ag.data.outputs.__default__")
    # the DRAINED content, not the generator object's repr
    assert out == "onetwo"
    assert "generator object" not in str(out), (
        "the generator OBJECT leaked into outputs"
    )


# --------------------------------------------------------------------------- #
# ASYNC def returning an async gen of DICTS (agent event shape)
# --------------------------------------------------------------------------- #
@pytest.mark.asyncio
async def test_async_def_returning_event_gen_records_event_list(in_memory_tracing):
    async def _events():
        yield {"type": "message_start", "data": {}}
        yield {"type": "done", "data": {}}

    @workflow()
    async def wf(value: str):
        return _events()

    response = await wf.invoke(request=_request())
    assert isinstance(response, WorkflowServiceStreamResponse)
    items = await _collect(response)
    assert [e["type"] for e in items] == ["message_start", "done"]

    root = _roots(in_memory_tracing.finished_spans())[0]
    captured = _json_attr(root, "ag.data.outputs.__default__")
    assert isinstance(captured, list), f"expected drained list, got {captured!r}"
    assert captured[0]["type"] == "message_start"
    assert captured[-1]["type"] == "done"


# --------------------------------------------------------------------------- #
# SYNC def that RETURNS a sync generator (the sync analogue)
# --------------------------------------------------------------------------- #
@pytest.mark.asyncio
async def test_sync_def_returning_sync_gen_records_drained_content(in_memory_tracing):
    def _events():
        yield "one"
        yield "two"

    @workflow()
    def wf(value: str):
        return _events()

    response = await wf.invoke(request=_request())
    assert isinstance(response, WorkflowServiceStreamResponse)
    assert await _collect(response) == ["one", "two"]

    root = _roots(in_memory_tracing.finished_spans())[0]
    _assert_workflow_root(root, name="wf")
    out = _attr(root, "ag.data.outputs.__default__")
    assert out == "onetwo"
    assert "generator object" not in str(out)


# --------------------------------------------------------------------------- #
# Span timing: the span must not export until the returned generator is drained.
# --------------------------------------------------------------------------- #
@pytest.mark.asyncio
async def test_returned_gen_span_not_exported_until_drained(in_memory_tracing):
    async def _events():
        yield "one"
        yield "two"

    @workflow()
    async def wf(value: str):
        return _events()

    response = await wf.invoke(request=_request())
    # invoke() returned the stream wrapper; nothing consumed yet -> no span exported.
    assert len(in_memory_tracing.finished_spans()) == 0
    await _collect(response)
    assert len(in_memory_tracing.finished_spans()) == 1
