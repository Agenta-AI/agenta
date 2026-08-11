"""
Matrix: handler SHAPE x Accept negotiation, at the route boundary
(`@workflow().invoke()` -> `handle_invoke_success(request, response)`).

This characterizes what `/invoke` does TODAY for every (shape, Accept) pair. It
is the baseline the `/invoke`-absorbs-`/messages` work must evolve: where a cell
is a 406 or an unreachable format now, the design adds a negotiation to fill it.

Shapes:  batch (async def -> value)  |  stream (async def -> yield)
Accept :  (none) | application/json | text/event-stream | application/x-ndjson

Current truth table (asserted below):

              | none      | json   | sse    | ndjson
    batch     | json 200  | json   | 406    | 406
    stream    | ndjson    | 406    | sse    | ndjson

Notes this surfaces for the design:
  - stream + json  -> 406: a streaming handler cannot yield a batch today
    (so `history=last` over a streaming agent needs explicit batch-collection).
  - vercel wire format is NOT reachable from Accept (it is endpoint-pinned on
    `/messages`); that is exactly negotiation #2 to add to `/invoke`.
"""

from contextlib import contextmanager

import pytest
from unittest.mock import MagicMock, patch

from agenta.sdk.decorators.running import workflow
from agenta.sdk.decorators.routing import handle_invoke_success
from agenta.sdk.models.workflows import WorkflowServiceRequest


# --------------------------------------------------------------------------- #
# Stubs (tracing + singleton are not under test)
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


def _http_request(accept: str = ""):
    req = MagicMock()
    req.headers = MagicMock()
    req.headers.get = lambda key, default="": (
        accept if key == "accept" and accept else default
    )
    return req


def _invoke_request():
    return WorkflowServiceRequest(data={"inputs": {"value": "x"}})


async def _batch_handler():
    with _quiet_runtime():

        @workflow()
        async def wf(value: str):
            return f"batch:{value}"

        return await wf.invoke(request=_invoke_request())


async def _stream_handler():
    with _quiet_runtime():

        @workflow()
        async def wf(value: str):
            yield f"a:{value}"
            yield f"b:{value}"

        return await wf.invoke(request=_invoke_request())


# --------------------------------------------------------------------------- #
# Batch handler row
# --------------------------------------------------------------------------- #
@pytest.mark.asyncio
async def test_batch_no_accept_is_json():
    http = await handle_invoke_success(_http_request(""), await _batch_handler())
    assert http.status_code == 200
    assert "application/json" in http.media_type


@pytest.mark.asyncio
async def test_batch_json_accept_is_json():
    http = await handle_invoke_success(
        _http_request("application/json"), await _batch_handler()
    )
    assert http.status_code == 200
    assert "application/json" in http.media_type


@pytest.mark.asyncio
async def test_batch_sse_accept_is_406():
    http = await handle_invoke_success(
        _http_request("text/event-stream"), await _batch_handler()
    )
    assert http.status_code == 406


@pytest.mark.asyncio
async def test_batch_ndjson_accept_is_406():
    http = await handle_invoke_success(
        _http_request("application/x-ndjson"), await _batch_handler()
    )
    assert http.status_code == 406


# --------------------------------------------------------------------------- #
# Stream handler row
# --------------------------------------------------------------------------- #
@pytest.mark.asyncio
async def test_stream_no_accept_is_ndjson():
    http = await handle_invoke_success(_http_request(""), await _stream_handler())
    assert http.status_code == 200
    assert "application/x-ndjson" in http.media_type


@pytest.mark.asyncio
async def test_stream_sse_accept_is_sse():
    http = await handle_invoke_success(
        _http_request("text/event-stream"), await _stream_handler()
    )
    assert http.status_code == 200
    assert "text/event-stream" in http.media_type


@pytest.mark.asyncio
async def test_stream_ndjson_accept_is_ndjson():
    http = await handle_invoke_success(
        _http_request("application/x-ndjson"), await _stream_handler()
    )
    assert http.status_code == 200
    assert "application/x-ndjson" in http.media_type


# NOTE: the stream + json Accept case is no longer a 406. The route maps a batch
# Accept onto flags.stream=False, so the normalizer aggregates the streaming
# handler into a batch. That path is driven through the REAL /invoke route (the
# Accept->flags mapping lives in the endpoint, not in handle_invoke_success), so
# it is tested over a TestClient in test_invoke_route_aggregation_routing.py.
