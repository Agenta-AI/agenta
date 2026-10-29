"""A streamed agent run records its usage on the workflow span.

The Vercel SSE framing drives the stream with one asyncio task per pull, so a keepalive can
race each chunk. The run's usage is written from the stream's ``finally``, after many pulls.
These tests stream a run with several chunks through the real framing and assert the usage
lands on the workflow root span.
"""

import importlib
from types import SimpleNamespace

import pytest

import agenta.sdk.agents.adapters.vercel.sse as sse_module
from agenta.sdk.agents.adapters.vercel.stream import agent_stream_to_vercel_stream
from agenta.sdk.agents.handler import agent_event_stream
from agenta.sdk.decorators.running import workflow

from oss.tests.pytest.integration.observability.test_workflow_instrument_programmatic import (  # noqa: E501
    _request,
    _roots,
    _attr,
)


pytestmark = [pytest.mark.integration, pytest.mark.speed_fast]

_USAGE = {"input": 3, "output": 5, "total": 8, "cost": 0.25}


class _Run:
    def __init__(self, events):
        self._events = events

    def __aiter__(self):
        return self._iter()

    async def _iter(self):
        for event in self._events:
            yield event

    def result(self):
        return SimpleNamespace(usage=_USAGE, stop_reason="end_turn")


class _Harness:
    async def setup(self):
        pass

    async def cleanup(self):
        pass

    async def stream(self, session_config, msgs):
        return _Run(
            [
                SimpleNamespace(type="message_start", data={"id": "m1"}),
                SimpleNamespace(type="message_delta", data={"id": "m1", "delta": "a"}),
                SimpleNamespace(type="message_delta", data={"id": "m1", "delta": "b"}),
                SimpleNamespace(type="message_end", data={"id": "m1"}),
                SimpleNamespace(type="done", data={"stopReason": "end_turn"}),
            ]
        )


async def _stream_run(sse):
    @workflow()
    async def agent(value: str):
        return agent_event_stream(_Harness(), None, [])

    response = await agent.invoke(request=_request())
    parts = agent_stream_to_vercel_stream(response.iterator())
    return [frame async for frame in sse.vercel_sse_stream(parts)]


def _assert_usage_on_root(tracing):
    root = _roots(tracing.finished_spans())[0]
    assert _attr(root, "gen_ai.usage.input_tokens") == 3
    assert _attr(root, "gen_ai.usage.output_tokens") == 5
    assert _attr(root, "gen_ai.usage.total_tokens") == 8
    assert _attr(root, "gen_ai.usage.cost") == 0.25


@pytest.mark.asyncio
async def test_streamed_run_records_usage_on_workflow_span(in_memory_tracing):
    frames = await _stream_run(sse_module)

    assert frames[-1] == "data: [DONE]\n\n"
    assert len([f for f in frames if '"text-delta"' in f]) == 2
    _assert_usage_on_root(in_memory_tracing)


@pytest.mark.asyncio
async def test_streamed_run_records_usage_across_keepalives(
    in_memory_tracing, monkeypatch
):
    monkeypatch.setenv("AGENTA_AGENT_SSE_KEEPALIVE_SECONDS", "0.001")
    mod = importlib.reload(sse_module)
    try:
        frames = await _stream_run(mod)
    finally:
        monkeypatch.delenv("AGENTA_AGENT_SSE_KEEPALIVE_SECONDS", raising=False)
        importlib.reload(sse_module)

    assert frames[-1] == "data: [DONE]\n\n"
    _assert_usage_on_root(in_memory_tracing)
