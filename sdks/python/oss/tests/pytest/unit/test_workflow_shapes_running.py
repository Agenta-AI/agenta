"""
Matrix: the four handler SHAPES a workflow author can write, invoked
PROGRAMMATICALLY via @workflow().invoke() (the lowest real altitude — how a user
runs a workflow in code, not the HTTP edge, not the normalizer internals).

The four shapes:

    1. sync  def  -> value          (batch)
    2. async def  -> value          (batch)
    3. sync  def  -> yield          (stream; sync generator)
    4. async def  -> yield          (stream; async generator)

Expectation (independent of HTTP/Accept): shapes 1-2 resolve to a batch response
carrying the value in data.outputs; shapes 3-4 resolve to a streaming response
whose iterator yields the produced items in order.

Built standalone (not reusing existing fixtures) so the matrix makes its own
assumptions explicit and any breakage is attributable to the shape, not shared
setup.
"""

from contextlib import contextmanager

import pytest
from unittest.mock import MagicMock, patch

from agenta.sdk.decorators.running import workflow
from agenta.sdk.models.workflows import (
    WorkflowServiceRequest,
    WorkflowServiceBatchResponse,
    WorkflowServiceStreamResponse,
)


# --------------------------------------------------------------------------- #
# Tracing/singleton stubs: invoke() opens tracing + reads the default singleton.
# Neither is under test here, so stub both to no-ops.
# --------------------------------------------------------------------------- #
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


async def _collect(stream_response) -> list:
    return [item async for item in stream_response.iterator()]


def _request(value: str = "x") -> WorkflowServiceRequest:
    return WorkflowServiceRequest(data={"inputs": {"value": value}})


# --------------------------------------------------------------------------- #
# Shape 1 — sync def -> value  (batch)
# --------------------------------------------------------------------------- #
@pytest.mark.asyncio
async def test_sync_function_returns_batch():
    with _quiet_runtime():

        @workflow()
        def wf(value: str):
            return f"sync:{value}"

        response = await wf.invoke(request=_request("a"))

    assert isinstance(response, WorkflowServiceBatchResponse)
    assert response.data.outputs == "sync:a"


# --------------------------------------------------------------------------- #
# Shape 2 — async def -> value  (batch)
# --------------------------------------------------------------------------- #
@pytest.mark.asyncio
async def test_async_function_returns_batch():
    with _quiet_runtime():

        @workflow()
        async def wf(value: str):
            return f"async:{value}"

        response = await wf.invoke(request=_request("b"))

    assert isinstance(response, WorkflowServiceBatchResponse)
    assert response.data.outputs == "async:b"


# --------------------------------------------------------------------------- #
# Shape 3 — sync def -> yield  (stream; sync generator)
# --------------------------------------------------------------------------- #
@pytest.mark.asyncio
async def test_sync_generator_returns_stream():
    with _quiet_runtime():

        @workflow()
        def wf(value: str):
            yield f"one:{value}"
            yield f"two:{value}"

        response = await wf.invoke(request=_request("c"))

    assert isinstance(response, WorkflowServiceStreamResponse)
    assert await _collect(response) == ["one:c", "two:c"]


# --------------------------------------------------------------------------- #
# Shape 4 — async def -> yield  (stream; async generator)
# --------------------------------------------------------------------------- #
@pytest.mark.asyncio
async def test_async_generator_returns_stream():
    with _quiet_runtime():

        @workflow()
        async def wf(value: str):
            yield f"one:{value}"
            yield f"two:{value}"

        response = await wf.invoke(request=_request("d"))

    assert isinstance(response, WorkflowServiceStreamResponse)
    assert await _collect(response) == ["one:d", "two:d"]


# --------------------------------------------------------------------------- #
# Edge cases most likely to expose a broken shape/combo
# --------------------------------------------------------------------------- #
@pytest.mark.asyncio
async def test_async_function_returning_none_is_batch_none():
    with _quiet_runtime():

        @workflow()
        async def wf(value: str):
            return None

        response = await wf.invoke(request=_request())

    assert isinstance(response, WorkflowServiceBatchResponse)
    assert response.data.outputs is None


@pytest.mark.asyncio
async def test_empty_sync_generator_streams_nothing():
    with _quiet_runtime():

        @workflow()
        def wf(value: str):
            return
            yield  # pragma: no cover  (marks this a generator fn)

        response = await wf.invoke(request=_request())

    assert isinstance(response, WorkflowServiceStreamResponse)
    assert await _collect(response) == []


@pytest.mark.asyncio
async def test_empty_async_generator_streams_nothing():
    with _quiet_runtime():

        @workflow()
        async def wf(value: str):
            if False:  # pragma: no cover
                yield  # marks this an async-generator fn

        response = await wf.invoke(request=_request())

    assert isinstance(response, WorkflowServiceStreamResponse)
    assert await _collect(response) == []


@pytest.mark.asyncio
async def test_async_generator_raising_midstream_surfaces():
    """A generator that raises AFTER yielding: the error happens during stream
    consumption, outside invoke()'s try. Asserts the raise is not silently
    swallowed (it should surface to the consumer, not vanish)."""
    with _quiet_runtime():

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


@pytest.mark.asyncio
async def test_sync_function_returning_coroutine_is_awaited():
    """Awkward shape: a *sync* def that returns a coroutine object. The
    normalizer awaits awaitables, so this should resolve to a batch value, not
    leak an un-awaited coroutine into outputs."""
    with _quiet_runtime():

        async def _inner(value):
            return f"inner:{value}"

        @workflow()
        def wf(value: str):
            return _inner(value)

        response = await wf.invoke(request=_request("e"))

    assert isinstance(response, WorkflowServiceBatchResponse)
    assert response.data.outputs == "inner:e"


async def _noop_revision_default_call_next(_request):
    return "ok"


@pytest.mark.asyncio
async def test_inline_agent_revision_without_parameters_uses_default_template():
    from agenta.sdk.contexts.running import RunningContext, running_context_manager
    from agenta.sdk.contexts.tracing import TracingContext, tracing_context_manager
    from agenta.sdk.middlewares.running.resolver import ResolverMiddleware
    from agenta.sdk.models.workflows import WorkflowInvokeRequest, WorkflowRequestData
    from agenta.sdk.utils.types import build_agent_v0_default

    request = WorkflowInvokeRequest(
        data=WorkflowRequestData(
            revision={
                "data": {
                    "uri": "agenta:builtin:agent:v0",
                    "url": "https://agent.internal",
                    "schemas": {"parameters": {"type": "object"}},
                }
            }
        )
    )

    with (
        running_context_manager(RunningContext()),
        tracing_context_manager(TracingContext()),
    ):
        await ResolverMiddleware()(request, _noop_revision_default_call_next)
        revision = RunningContext.get().revision

    expected_parameters = {"agent": build_agent_v0_default()}
    assert request.data.parameters == expected_parameters
    assert revision["data"]["parameters"] == expected_parameters


@pytest.mark.asyncio
async def test_inline_agent_revision_with_parameters_stays_authoritative():
    from agenta.sdk.contexts.running import RunningContext, running_context_manager
    from agenta.sdk.contexts.tracing import TracingContext, tracing_context_manager
    from agenta.sdk.middlewares.running.resolver import ResolverMiddleware
    from agenta.sdk.models.workflows import WorkflowInvokeRequest, WorkflowRequestData

    explicit_parameters = {
        "agent": {
            "instructions": {"agents_md": "Use only this template."},
            "llm": {"provider": "openai", "model": "gpt-custom"},
            "tools": [{"type": "builtin", "name": "read_file"}],
        }
    }
    request = WorkflowInvokeRequest(
        data=WorkflowRequestData(
            revision={
                "data": {
                    "uri": "agenta:builtin:agent:v0",
                    "url": "https://agent.internal",
                    "parameters": explicit_parameters,
                }
            }
        )
    )

    with (
        running_context_manager(RunningContext()),
        tracing_context_manager(TracingContext()),
    ):
        await ResolverMiddleware()(request, _noop_revision_default_call_next)
        revision = RunningContext.get().revision

    assert request.data.parameters == explicit_parameters
    assert revision["data"]["parameters"] == explicit_parameters
