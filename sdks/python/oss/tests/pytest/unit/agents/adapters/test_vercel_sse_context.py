"""The Vercel SSE framing must not sever the context the stream was entered with.

The framing races each upstream pull against a keepalive tick. Racing it with one asyncio task
per pull is what breaks tracing: a task runs on a COPY of this generator's context, so anything
the upstream attaches while producing the first chunk — above all the workflow span that the
``instrument`` decorator activates INSIDE the streamed generator's body — dies with that copy.
From the second chunk on, and in the upstream's ``finally``, the current span is then a
non-recording one and every attribute written there is silently dropped, which is how streaming
runs stopped recording token/cost usage.

These tests pin the property directly: the workflow span stays current for the whole stream, at
the DEFAULT keepalive interval and across an interval that actually fires keepalives.
"""

from __future__ import annotations

import asyncio
import contextlib
import importlib
from typing import Any, AsyncIterator, Dict, List

from opentelemetry import context as otel_context
from opentelemetry import trace as otel_trace
from opentelemetry.sdk.trace import TracerProvider

import agenta.sdk.agents.adapters.vercel.sse as sse_module
from agenta.sdk.agents.tracing import record_usage

_USAGE = {"input": 3, "output": 5, "total": 8, "cost": 0.25}


def _workflow_span():
    """A real (recording) SDK span, isolated from whatever global provider the suite installed."""
    return TracerProvider().get_tracer("agenta.tests").start_span("workflow")


def _instrumented_parts(
    span,
    seen: List[Any],
    *,
    count: int = 4,
    gap: float = 0.0,
) -> AsyncIterator[Dict[str, Any]]:
    """Mirror the SDK instrumentation's streamed-generator wrapper.

    ``instrument`` re-attaches the captured otel context and activates the workflow span from
    INSIDE the generator body (see ``_wrap_returned_gen``), and the agent handler stamps usage
    from the generator's ``finally``. Both only work if the framing keeps driving this generator
    on one context.
    """
    captured = otel_context.get_current()

    async def parts() -> AsyncIterator[Dict[str, Any]]:
        token = otel_context.attach(captured)
        try:
            with otel_trace.use_span(span, end_on_exit=False):
                try:
                    for index in range(count):
                        if gap:
                            await asyncio.sleep(gap)
                        seen.append(otel_trace.get_current_span())
                        yield {"type": "text-delta", "delta": str(index)}
                finally:
                    seen.append(otel_trace.get_current_span())
                    record_usage(_USAGE)
        finally:
            with contextlib.suppress(Exception):
                otel_context.detach(token)

    return parts()


async def _collect(aiter) -> List[str]:
    return [chunk async for chunk in aiter]


def _assert_span_stayed_current(span, seen: List[Any]) -> None:
    assert seen, "the upstream never ran"
    assert all(observed is span for observed in seen), (
        "the workflow span stopped being current mid-stream: "
        f"{[getattr(o, 'name', type(o).__name__) for o in seen]}"
    )
    assert all(observed.is_recording() for observed in seen)


def _assert_usage_landed(span) -> None:
    attributes = dict(span.attributes or {})
    assert attributes.get("gen_ai.usage.input_tokens") == 3
    assert attributes.get("gen_ai.usage.output_tokens") == 5
    assert attributes.get("gen_ai.usage.total_tokens") == 8
    assert attributes.get("gen_ai.usage.cost") == 0.25


async def test_workflow_span_stays_current_across_the_stream():
    # Default keepalive interval, no silent gap: no keepalive frame is due, yet the context must
    # already survive — the regression was in how the pull is driven, not in the keepalive frame.
    span = _workflow_span()
    seen: List[Any] = []

    chunks = await _collect(
        sse_module.vercel_sse_stream(_instrumented_parts(span, seen))
    )

    assert chunks[-1] == "data: [DONE]\n\n"
    assert len([c for c in chunks if c.startswith("data: ")]) == 5  # 4 parts + [DONE]
    _assert_span_stayed_current(span, seen)
    _assert_usage_landed(span)


async def test_workflow_span_survives_keepalive_ticks(monkeypatch):
    # The same property while keepalives actually fire: every gap times out a pull, and the
    # resumed pull must land back on the same context.
    monkeypatch.setenv("AGENTA_AGENT_SSE_KEEPALIVE_SECONDS", "0.02")
    mod = importlib.reload(sse_module)
    try:
        span = _workflow_span()
        seen: List[Any] = []

        chunks = await _collect(
            mod.vercel_sse_stream(_instrumented_parts(span, seen, count=3, gap=0.05))
        )
    finally:
        monkeypatch.delenv("AGENTA_AGENT_SSE_KEEPALIVE_SECONDS", raising=False)
        importlib.reload(sse_module)

    assert [c for c in chunks if c == ": keepalive\n\n"], "no keepalive rode the gaps"
    payloads = [c for c in chunks if c.startswith("data: ")]
    assert len(payloads) == 4  # 3 parts + [DONE], none dropped or duplicated
    _assert_span_stayed_current(span, seen)
    _assert_usage_landed(span)


async def test_disconnect_tears_down_the_in_flight_pull(monkeypatch):
    # A client that walks away mid-stream must not strand the pull that is still outstanding.
    monkeypatch.setenv("AGENTA_AGENT_SSE_KEEPALIVE_SECONDS", "0.02")
    mod = importlib.reload(sse_module)
    before = asyncio.all_tasks()
    torn_down = asyncio.Event()
    try:

        async def parts() -> AsyncIterator[Dict[str, Any]]:
            yield {"type": "start"}
            try:
                await asyncio.sleep(30)  # a part that never arrives
            except asyncio.CancelledError:
                torn_down.set()
                raise
            yield {"type": "finish"}

        frames: List[str] = []
        stream = mod.vercel_sse_stream(parts())

        async def consume() -> None:
            async for frame in stream:
                frames.append(frame)

        consumer = asyncio.create_task(consume())
        await asyncio.sleep(0.1)  # first part out, keepalives now riding the silent gap
        consumer.cancel()
        with contextlib.suppress(asyncio.CancelledError):
            await consumer
        await asyncio.sleep(0.05)
    finally:
        monkeypatch.delenv("AGENTA_AGENT_SSE_KEEPALIVE_SECONDS", raising=False)
        importlib.reload(sse_module)

    assert frames[0] == 'data: {"type": "start"}\n\n'
    assert ": keepalive\n\n" in frames
    assert torn_down.is_set(), "the outstanding pull was never cancelled"
    leaked = [task for task in asyncio.all_tasks() - before if not task.done()]
    assert not leaked, f"pull left running after disconnect: {leaked}"
