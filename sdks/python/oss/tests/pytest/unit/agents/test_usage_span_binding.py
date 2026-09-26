"""Usage lands on the workflow span even when the run's ambient context is gone.

``record_usage`` runs from the run's teardown: on the streaming path that is the ``finally`` of
a generator the server drives long after the handler frame returned, and whatever drives it may
carry only a copy of the context that made the workflow span current. Reading the ambient span
there is therefore not sound — a lost activation turns every usage write into a no-op on a
non-recording span, with no error anywhere. The handler pins the span it captured at run start
instead, which these tests hold it to by draining the stream under an adverse context.
"""

from __future__ import annotations

import asyncio
from typing import Any, Dict, List, Optional

from opentelemetry import trace as otel_trace
from opentelemetry.sdk.trace import TracerProvider

from agenta.sdk.agents import AgentResult
from agenta.sdk.agents.handler import AgentComposition, make_agent_handler
from agenta.sdk.agents.tracing import record_usage
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


async def test_composition_recorder_without_a_span_parameter_still_sees_it(
    make_backend,
):
    # The composition seam predates the span argument: a `(usage)`-only recorder must keep
    # working AND must still read the workflow span from the ambient context.
    seen: List[Any] = []

    def legacy_recorder(usage: Optional[Dict[str, Any]]) -> None:
        seen.append((usage, otel_trace.get_current_span()))

    backend = make_backend(result=AgentResult(output="ok", usage=dict(_USAGE)))
    handler = make_agent_handler(
        AgentComposition(
            select_backend=lambda template: backend,
            record_usage=legacy_recorder,
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


def test_record_usage_stamps_the_given_span_over_the_ambient_one():
    span = _workflow_span()

    # No span is current here: the ambient read would write to a NonRecordingSpan and vanish.
    assert not otel_trace.get_current_span().is_recording()
    record_usage(_USAGE, span=span)

    assert _usage_attributes(span)["gen_ai.usage.total_tokens"] == 8
    assert _usage_attributes(span)["gen_ai.usage.cost"] == 0.25
