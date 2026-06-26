"""
`request.flags.history` sets how many messages the (always-a-list) batch output
holds, when a streaming handler is aggregated to batch (stream=False):

    history = True   -> full list of all aggregated events
    history = False  -> last element only, as a one-element list  [<last>]
    history unset    -> defaults to False (last)

Output is ALWAYS a list (no separate single-message surface). "last" is the list
truncated to its final element, not a different shape.

In stream mode `history` is moot (the stream is the full series anyway).

RED today: no aggregation, no flag reading. These pin the target.
"""

from contextlib import contextmanager

import pytest
from unittest.mock import MagicMock, patch

from agenta.sdk.decorators.running import workflow
from agenta.sdk.models.workflows import (
    WorkflowServiceRequest,
    WorkflowServiceBatchResponse,
)


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


def _request(*, stream, history=None):
    flags = {"stream": stream}
    if history is not None:
        flags["history"] = history
    return WorkflowServiceRequest(data={"inputs": {"value": "x"}}, flags=flags)


def _three_event_workflow():
    @workflow()
    async def wf(value: str):
        yield f"a:{value}"
        yield f"b:{value}"
        yield f"c:{value}"

    return wf


@pytest.mark.asyncio
async def test_history_true_returns_full_list():
    with _quiet_runtime():
        wf = _three_event_workflow()
        response = await wf.invoke(request=_request(stream=False, history=True))

    assert isinstance(response, WorkflowServiceBatchResponse)
    assert response.data.outputs == ["a:x", "b:x", "c:x"]


@pytest.mark.asyncio
async def test_history_false_returns_last_only_as_list():
    with _quiet_runtime():
        wf = _three_event_workflow()
        response = await wf.invoke(request=_request(stream=False, history=False))

    assert isinstance(response, WorkflowServiceBatchResponse)
    assert response.data.outputs == ["c:x"]


@pytest.mark.asyncio
async def test_history_unset_defaults_to_last():
    with _quiet_runtime():
        wf = _three_event_workflow()
        response = await wf.invoke(request=_request(stream=False))

    assert isinstance(response, WorkflowServiceBatchResponse)
    assert response.data.outputs == ["c:x"]
