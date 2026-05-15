"""
Integration tests for Accept header negotiation end-to-end.

These tests combine workflow.invoke() → handle_invoke_success() to verify the
full negotiation path without requiring a running HTTP server.

Coverage:
- Batch handler + no Accept → 200 JSON
- Batch handler + application/json Accept → 200 JSON
- Batch handler + stream Accept → 406
- Stream handler + no Accept → 200 NDJSON
- Stream handler + SSE Accept → 200 SSE
- Stream handler + application/json Accept → 406
"""

import json
import pytest
from unittest.mock import MagicMock, patch

from agenta.sdk.decorators.running import workflow, inspect_workflow
from agenta.sdk.decorators.routing import handle_invoke_success
from agenta.sdk.models.workflows import (
    WorkflowInspectRequest,
    WorkflowServiceRequest,
    WorkflowServiceBatchResponse,
    WorkflowServiceStreamResponse,
    WorkflowRevisionData,
)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _mock_request(accept: str = "") -> MagicMock:
    req = MagicMock()
    req.headers = MagicMock()
    req.headers.get = lambda key, default="": (
        accept if key == "accept" and accept else default
    )
    return req


async def _inspect_before_invoke(wf) -> None:
    inspected = await wf.inspect()
    assert isinstance(inspected, WorkflowServiceRequest)
    assert inspected.data is not None
    assert inspected.data.revision is not None


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------


@pytest.fixture()
def batch_workflow():
    """A simple @workflow-decorated batch handler."""
    with patch("agenta.sdk.decorators.tracing.ag") as mock_ag:
        mock_span = MagicMock()
        mock_span.is_recording.return_value = False
        mock_span.get_span_context.return_value = MagicMock(trace_id=0, span_id=0)
        mock_ag.tracing = MagicMock()
        mock_ag.tracing.get_current_span.return_value = mock_span
        mock_ag.tracing.redact = None
        mock_tracer = MagicMock()
        mock_tracer.start_as_current_span.return_value.__enter__ = MagicMock(
            return_value=mock_span
        )
        mock_tracer.start_as_current_span.return_value.__exit__ = MagicMock(
            return_value=None
        )
        mock_ag.tracer = mock_tracer

        with patch("agenta.sdk.decorators.running.ag") as mock_run_ag:
            mock_run_ag.DEFAULT_AGENTA_SINGLETON_INSTANCE = MagicMock()
            mock_run_ag.DEFAULT_AGENTA_SINGLETON_INSTANCE.api_key = None

            @workflow()
            def my_batch(prompt: str):
                return f"result: {prompt}"

            yield my_batch


@pytest.fixture()
def stream_workflow():
    """A simple @workflow-decorated async generator (stream) handler."""
    with patch("agenta.sdk.decorators.tracing.ag") as mock_ag:
        mock_span = MagicMock()
        mock_span.is_recording.return_value = False
        mock_span.get_span_context.return_value = MagicMock(trace_id=0, span_id=0)
        mock_ag.tracing = MagicMock()
        mock_ag.tracing.get_current_span.return_value = mock_span
        mock_ag.tracing.redact = None
        mock_tracer = MagicMock()
        mock_tracer.start_as_current_span.return_value.__enter__ = MagicMock(
            return_value=mock_span
        )
        mock_tracer.start_as_current_span.return_value.__exit__ = MagicMock(
            return_value=None
        )
        mock_ag.tracer = mock_tracer

        with patch("agenta.sdk.decorators.running.ag") as mock_run_ag:
            mock_run_ag.DEFAULT_AGENTA_SINGLETON_INSTANCE = MagicMock()
            mock_run_ag.DEFAULT_AGENTA_SINGLETON_INSTANCE.api_key = None

            @workflow()
            async def my_stream(prompt: str):
                yield f"chunk1: {prompt}"
                yield f"chunk2: {prompt}"

            yield my_stream


# ---------------------------------------------------------------------------
# Batch handler — HTTP negotiation
# ---------------------------------------------------------------------------


class TestBatchHandlerNegotiation:
    @pytest.mark.asyncio
    async def test_no_accept_returns_json(self, batch_workflow):
        req = WorkflowServiceRequest(data={"inputs": {"prompt": "hello"}})
        await _inspect_before_invoke(batch_workflow)
        response = await batch_workflow.invoke(request=req)
        assert isinstance(response, WorkflowServiceBatchResponse)

        http = await handle_invoke_success(_mock_request(""), response)
        assert http.status_code == 200
        assert "application/json" in http.media_type

    @pytest.mark.asyncio
    async def test_json_accept_returns_json(self, batch_workflow):
        req = WorkflowServiceRequest(data={"inputs": {"prompt": "hello"}})
        await _inspect_before_invoke(batch_workflow)
        response = await batch_workflow.invoke(request=req)

        http = await handle_invoke_success(_mock_request("application/json"), response)
        assert http.status_code == 200
        assert "application/json" in http.media_type

    @pytest.mark.asyncio
    async def test_sse_accept_returns_406(self, batch_workflow):
        req = WorkflowServiceRequest(data={"inputs": {"prompt": "hello"}})
        await _inspect_before_invoke(batch_workflow)
        response = await batch_workflow.invoke(request=req)

        http = await handle_invoke_success(_mock_request("text/event-stream"), response)
        assert http.status_code == 406
        body = json.loads(http.body)
        assert body["requested"] == "text/event-stream"
        assert "application/json" in body["supported"]

    @pytest.mark.asyncio
    async def test_ndjson_accept_returns_406(self, batch_workflow):
        req = WorkflowServiceRequest(data={"inputs": {"prompt": "hello"}})
        await _inspect_before_invoke(batch_workflow)
        response = await batch_workflow.invoke(request=req)

        http = await handle_invoke_success(
            _mock_request("application/x-ndjson"), response
        )
        assert http.status_code == 406

    @pytest.mark.asyncio
    async def test_jsonl_accept_returns_406(self, batch_workflow):
        req = WorkflowServiceRequest(data={"inputs": {"prompt": "hello"}})
        await _inspect_before_invoke(batch_workflow)
        response = await batch_workflow.invoke(request=req)

        http = await handle_invoke_success(_mock_request("application/jsonl"), response)
        assert http.status_code == 406


# ---------------------------------------------------------------------------
# Stream handler — HTTP negotiation
# ---------------------------------------------------------------------------


class TestStreamHandlerNegotiation:
    @pytest.mark.asyncio
    async def test_no_accept_returns_ndjson(self, stream_workflow):
        req = WorkflowServiceRequest(data={"inputs": {"prompt": "hello"}})
        await _inspect_before_invoke(stream_workflow)
        response = await stream_workflow.invoke(request=req)
        assert isinstance(response, WorkflowServiceStreamResponse)

        http = await handle_invoke_success(_mock_request(""), response)
        assert http.status_code == 200
        assert "application/x-ndjson" in http.media_type

    @pytest.mark.asyncio
    async def test_sse_accept_returns_sse(self, stream_workflow):
        req = WorkflowServiceRequest(data={"inputs": {"prompt": "hello"}})
        await _inspect_before_invoke(stream_workflow)
        response = await stream_workflow.invoke(request=req)

        http = await handle_invoke_success(_mock_request("text/event-stream"), response)
        assert http.status_code == 200
        assert "text/event-stream" in http.media_type

    @pytest.mark.asyncio
    async def test_ndjson_accept_returns_ndjson(self, stream_workflow):
        req = WorkflowServiceRequest(data={"inputs": {"prompt": "hello"}})
        await _inspect_before_invoke(stream_workflow)
        response = await stream_workflow.invoke(request=req)

        http = await handle_invoke_success(
            _mock_request("application/x-ndjson"), response
        )
        assert http.status_code == 200
        assert "application/x-ndjson" in http.media_type

    @pytest.mark.asyncio
    async def test_json_accept_returns_406(self, stream_workflow):
        req = WorkflowServiceRequest(data={"inputs": {"prompt": "hello"}})
        await _inspect_before_invoke(stream_workflow)
        response = await stream_workflow.invoke(request=req)

        http = await handle_invoke_success(_mock_request("application/json"), response)
        assert http.status_code == 406
        body = json.loads(http.body)
        assert body["requested"] == "application/json"


class TestInspectNegotiation:
    @pytest.mark.asyncio
    async def test_inspect_accepts_selector_and_resolves_references(self):
        request = WorkflowInspectRequest(
            references={"environment": {"slug": "prod"}},
            selector={"key": "qa.revision"},
        )

        with patch(
            "agenta.sdk.decorators.running.resolve_references",
            return_value=WorkflowRevisionData(
                uri="agenta:builtin:auto_exact_match:v0",
                parameters={"correct_answer_key": "correct_answer"},
            ),
        ) as resolve_references:
            inspected = await inspect_workflow(request=request)

        resolve_references.assert_awaited_once()
        assert inspected.selector is not None
        assert inspected.selector.key == "qa.revision"
        assert inspected.data is not None
        assert inspected.data.revision is not None
        assert (
            inspected.data.revision["data"]["uri"]
            == "agenta:builtin:auto_exact_match:v0"
        )
