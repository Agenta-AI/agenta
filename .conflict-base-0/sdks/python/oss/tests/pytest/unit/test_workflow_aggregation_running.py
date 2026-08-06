"""
Level 2 (specs.md "Testing contract"): @workflow programmatic invoke, body
flags only. The normalizer is shape-agnostic passthrough (specs.md
"Removals") — no drain, no trim, no output mutation. Generator handlers
always become WorkflowServiceStreamResponse regardless of `stream`; dict
returns pass through byte-identical regardless of `trim`. `resolve` is
consumed and stripped by the ResolverMiddleware before the handler runs, so
a request-taking handler sees exactly {stream, trim, force}.
"""

from contextlib import contextmanager
from itertools import product

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


# tri-state axis: unset/False/True
_TRI = (None, False, True)


def _flags_dict(stream=None, trim=None, force=None, resolve=None):
    flags = {}
    if stream is not None:
        flags["stream"] = stream
    if trim is not None:
        flags["trim"] = trim
    if force is not None:
        flags["force"] = force
    if resolve is not None:
        flags["resolve"] = resolve
    return flags


def _request(**flag_kwargs) -> WorkflowServiceRequest:
    return WorkflowServiceRequest(
        data={"inputs": {"value": "x"}},
        flags=_flags_dict(**flag_kwargs),
    )


def _generator_workflow():
    @workflow()
    async def wf(value: str):
        yield f"a:{value}"
        yield f"b:{value}"

    return wf


def _envelope_workflow():
    @workflow()
    async def wf(value: str):
        return {
            "messages": [
                {"role": "assistant", "content": f"a:{value}"},
                {"role": "assistant", "content": f"b:{value}"},
                {"role": "assistant", "content": f"c:{value}"},
            ]
        }

    return wf


_ENVELOPE_OUTPUTS = {
    "messages": [
        {"role": "assistant", "content": "a:x"},
        {"role": "assistant", "content": "b:x"},
        {"role": "assistant", "content": "c:x"},
    ]
}


# Generator handler always streams, regardless of stream/trim/force.
@pytest.mark.parametrize("stream,trim,force", list(product(_TRI, _TRI, _TRI)))
@pytest.mark.asyncio
async def test_generator_handler_always_streams(stream, trim, force):
    with _quiet_runtime():
        wf = _generator_workflow()
        response = await wf.invoke(
            request=_request(stream=stream, trim=trim, force=force)
        )

    assert isinstance(response, WorkflowServiceStreamResponse)
    assert await _collect(response) == ["a:x", "b:x"]


# Dict-returning handler: outputs pass through byte-identical, no envelope trim here.
@pytest.mark.parametrize("stream,trim,force", list(product(_TRI, _TRI, _TRI)))
@pytest.mark.asyncio
async def test_dict_handler_passthrough_unmodified(stream, trim, force):
    with _quiet_runtime():
        wf = _envelope_workflow()
        response = await wf.invoke(
            request=_request(stream=stream, trim=trim, force=force)
        )

    assert isinstance(response, WorkflowServiceBatchResponse)
    assert response.data.outputs == _ENVELOPE_OUTPUTS


# Flag-blind handler (no `request` param): identical output across every flag combo.
def _flag_blind_function_workflow():
    @workflow()
    async def wf(value: str):
        return f"blind:{value}"

    return wf


@pytest.mark.parametrize("stream,trim,force", list(product(_TRI, _TRI, _TRI)))
@pytest.mark.asyncio
async def test_flag_blind_function_handler_identical_across_flags(stream, trim, force):
    with _quiet_runtime():
        wf = _flag_blind_function_workflow()
        response = await wf.invoke(
            request=_request(stream=stream, trim=trim, force=force)
        )

    assert isinstance(response, WorkflowServiceBatchResponse)
    assert response.data.outputs == "blind:x"


@pytest.mark.parametrize("stream,trim,force", list(product(_TRI, _TRI, _TRI)))
@pytest.mark.asyncio
async def test_flag_blind_generator_handler_identical_across_flags(stream, trim, force):
    with _quiet_runtime():
        wf = _generator_workflow()
        response = await wf.invoke(
            request=_request(stream=stream, trim=trim, force=force)
        )

    assert isinstance(response, WorkflowServiceStreamResponse)
    assert await _collect(response) == ["a:x", "b:x"]


# Request-taking handler: sees request.flags with `resolve` always stripped, others verbatim.
def _flag_capturing_workflow(seen: dict):
    @workflow()
    async def wf(request, value: str):
        seen["flags"] = dict(request.flags or {})
        return f"seen:{value}"

    return wf


@pytest.mark.parametrize("resolve", [None, True, False])
@pytest.mark.parametrize("stream,trim,force", list(product(_TRI, _TRI, _TRI)))
@pytest.mark.asyncio
async def test_request_taking_handler_flags_have_resolve_stripped(
    stream, trim, force, resolve
):
    seen: dict = {}
    with _quiet_runtime():
        wf = _flag_capturing_workflow(seen)
        await wf.invoke(
            request=_request(stream=stream, trim=trim, force=force, resolve=resolve)
        )

    assert "resolve" not in seen["flags"]

    expected = {}
    if stream is not None:
        expected["stream"] = stream
    if trim is not None:
        expected["trim"] = trim
    if force is not None:
        expected["force"] = force
    assert seen["flags"] == expected


# Body flags {stream, trim, force} reach the handler untouched — pins values, not just the strip.
@pytest.mark.parametrize("stream,trim,force", list(product(_TRI, _TRI, _TRI)))
@pytest.mark.asyncio
async def test_handler_owned_flags_arrive_verbatim(stream, trim, force):
    seen: dict = {}
    with _quiet_runtime():
        wf = _flag_capturing_workflow(seen)
        await wf.invoke(request=_request(stream=stream, trim=trim, force=force))

    if stream is not None:
        assert seen["flags"]["stream"] is stream
    else:
        assert "stream" not in seen["flags"]

    if trim is not None:
        assert seen["flags"]["trim"] is trim
    else:
        assert "trim" not in seen["flags"]

    if force is not None:
        assert seen["flags"]["force"] is force
    else:
        assert "force" not in seen["flags"]
