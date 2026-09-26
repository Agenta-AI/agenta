"""Usage lands on the workflow span even when the run's ambient context is gone.

``record_usage`` runs from the run's teardown: on the streaming path that is the ``finally`` of
a generator the server drives long after the handler frame returned, and whatever drives it may
carry only a copy of the context that made the workflow span current. Reading the ambient span
there is therefore not sound: a lost activation turns every usage write into a no-op on a
non-recording span, with no error anywhere. The handler makes the span it captured at run start
current again around the recorder. These tests drain the stream under an adverse context.
"""

from __future__ import annotations

import asyncio
from typing import Any, Dict, List, Optional

from opentelemetry import trace as otel_trace
from opentelemetry.sdk.trace import TracerProvider

from agenta.sdk.agents import AgentResult
from agenta.sdk.agents.handler import AgentComposition, make_agent_handler
from agenta.sdk.models.workflows import WorkflowServiceRequest

_USAGE = {"input": 3, "output": 5, "total": 8, "cost": 0.25}


def _workflow_span():
    return TracerProvider().get_tracer("agenta.tests").start_span("workflow")


def _params() -> Dict[str, Any]:
    return {"agent": {"harness": {"kind": "pi_core"}}}


def _messages() -> List[Dict[str, Any]]:
    return [{"role": "user", "content": "hi"}]


async def _drain_one_task_per_pull(stream) -> List[Any]:
    """Drain the way the SSE framing does when it races a keepalive: a task per pull, each on
    its own copy of this context."""
    iterator = stream.__aiter__()
    out: List[Any] = []
    while True:
        pull = asyncio.ensure_future(iterator.__anext__())
        try:
            out.append(await pull)
        except StopAsyncIteration:
            break
    return out


def _usage_attributes(span) -> Dict[str, Any]:
    return {
        key: value
        for key, value in dict(span.attributes or {}).items()
        if key.startswith("gen_ai.usage.")
    }


async def test_streaming_usage_lands_on_the_span_captured_at_run_start(make_backend):
    backend = make_backend(result=AgentResult(output="ok", usage=dict(_USAGE)))
    handler = make_agent_handler(
        AgentComposition(select_backend=lambda template: backend)
    )
    span = _workflow_span()

    # The span is current only for the handler call — exactly the instrumentation's shape.
    with otel_trace.use_span(span, end_on_exit=False):
        stream = await handler(
            request=WorkflowServiceRequest(flags={"stream": True}),
            messages=_messages(),
            parameters=_params(),
        )

    assert not otel_trace.get_current_span().is_recording()
    await _drain_one_task_per_pull(stream)

    assert _usage_attributes(span) == {
        "gen_ai.usage.input_tokens": 3,
        "gen_ai.usage.output_tokens": 5,
        "gen_ai.usage.prompt_tokens": 3,
        "gen_ai.usage.completion_tokens": 5,
        "gen_ai.usage.total_tokens": 8,
        "gen_ai.usage.cost": 0.25,
    }
    assert span.attributes["ag.flags.aggregate_usage"] is True


async def test_batch_usage_lands_on_the_span_captured_at_run_start(make_backend):
    backend = make_backend(result=AgentResult(output="ok", usage=dict(_USAGE)))
    handler = make_agent_handler(
        AgentComposition(select_backend=lambda template: backend)
    )
    span = _workflow_span()

    with otel_trace.use_span(span, end_on_exit=False):
        await handler(
            request=WorkflowServiceRequest(),
            messages=_messages(),
            parameters=_params(),
        )

    assert _usage_attributes(span)["gen_ai.usage.total_tokens"] == 8


async def test_injected_recorder_sees_the_workflow_span_as_current(make_backend):
    seen: List[Any] = []

    def recorder(usage: Optional[Dict[str, Any]]) -> None:
        seen.append((usage, otel_trace.get_current_span()))

    backend = make_backend(result=AgentResult(output="ok", usage=dict(_USAGE)))
    handler = make_agent_handler(
        AgentComposition(
            select_backend=lambda template: backend,
            record_usage=recorder,
        )
    )
    span = _workflow_span()

    with otel_trace.use_span(span, end_on_exit=False):
        stream = await handler(
            request=WorkflowServiceRequest(flags={"stream": True}),
            messages=_messages(),
            parameters=_params(),
        )
    await _drain_one_task_per_pull(stream)

    assert len(seen) == 1
    usage, observed_span = seen[0]
    assert usage == _USAGE
    assert observed_span is span
