"""
The stream<->batch decision belongs at the WORKFLOW level (the middleware chain
under `wf.invoke()`), NOT at the HTTP/routing layer — because a PROGRAMMATIC
caller (no HTTP, no Accept) must also be able to ask a streaming handler for a
batch result and get one.

Model under test (the target):
  - A handler yields events (streaming is the single source of truth).
  - `request.flags.stream` is the per-call command:
      stream = False  -> the SDK drains the generator and folds the events into a
                         batch response (outputs = aggregated list of messages).
      stream = True   -> the stream is passed through as a streaming response.
  - This happens inside `wf.invoke()` (the Normalizer owns the batch/stream
    decision), so the response object is already correct before any HTTP layer.

These are RED today: the normalizer decides batch-vs-stream purely from the
handler's RETURN shape and ignores `request.flags.stream`. A streaming handler
therefore always yields a stream, even when the caller asked for batch.
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


def _request(*, stream, history=None):
    # The per-call command directives. The request boundary is a loose dict;
    # WorkflowInvokeRequestFlags is the typed accessor the running layer parses it with.
    flags = {"stream": stream}
    if history is not None:
        flags["history"] = history
    return WorkflowServiceRequest(
        data={"inputs": {"value": "x"}},
        flags=flags,
    )


# --------------------------------------------------------------------------- #
# stream=True  -> streaming handler passes through as a stream  (works today)
# --------------------------------------------------------------------------- #
@pytest.mark.asyncio
async def test_streaming_handler_stream_true_is_stream():
    with _quiet_runtime():

        @workflow()
        async def wf(value: str):
            yield f"a:{value}"
            yield f"b:{value}"

        response = await wf.invoke(request=_request(stream=True))

    assert isinstance(response, WorkflowServiceStreamResponse)
    assert await _collect(response) == ["a:x", "b:x"]


# --------------------------------------------------------------------------- #
# stream=False -> streaming handler AGGREGATES into a batch.
# (history=True asserts the full aggregated list; history is covered on its own in
# test_workflow_history_running.py.)
# --------------------------------------------------------------------------- #
@pytest.mark.asyncio
async def test_streaming_handler_stream_false_aggregates_to_batch():
    with _quiet_runtime():

        @workflow()
        async def wf(value: str):
            yield f"a:{value}"
            yield f"b:{value}"

        response = await wf.invoke(request=_request(stream=False, history=True))

    assert isinstance(response, WorkflowServiceBatchResponse)
    assert response.data.outputs == ["a:x", "b:x"]
