"""
Unit tests for HTTP content negotiation in sdk/agenta/sdk/decorators/routing.py.

Tests cover:
- _parse_accept: mapping Accept header values to supported media types
- handle_invoke_success: strict batch/stream matching, 406 on mismatch
- _make_not_acceptable_response: 406 body structure
"""

import json
import pytest
from unittest.mock import MagicMock

from agenta.sdk.decorators.routing import (
    BATCH_MEDIA_TYPES,
    STREAM_MEDIA_TYPES,
    SUPPORTED_MEDIA_TYPES,
    _parse_accept,
    _make_not_acceptable_response,
    handle_invoke_success,
)
from agenta.sdk.models.workflows import (
    WorkflowServiceBatchResponse,
    WorkflowServiceStreamResponse,
    WorkflowServiceResponseData,
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


async def _empty_gen():
    return
    yield  # make it an async generator


def _stream_response(items=None) -> WorkflowServiceStreamResponse:
    if items is None:
        items = ["chunk1", "chunk2"]

    async def gen():
        for item in items:
            yield item

    return WorkflowServiceStreamResponse(generator=gen)


def _batch_response(output="result") -> WorkflowServiceBatchResponse:
    return WorkflowServiceBatchResponse(
        data=WorkflowServiceResponseData(outputs=output)
    )


# ---------------------------------------------------------------------------
# _parse_accept
# ---------------------------------------------------------------------------


class TestParseAccept:
    def test_no_accept_header_returns_none(self):
        req = _mock_request("")
        assert _parse_accept(req) is None

    def test_wildcard_returns_none(self):
        req = _mock_request("*/*")
        assert _parse_accept(req) is None

    def test_application_json(self):
        req = _mock_request("application/json")
        assert _parse_accept(req) == "application/json"

    def test_text_event_stream(self):
        req = _mock_request("text/event-stream")
        assert _parse_accept(req) == "text/event-stream"

    def test_application_x_ndjson(self):
        req = _mock_request("application/x-ndjson")
        assert _parse_accept(req) == "application/x-ndjson"

    def test_application_jsonl(self):
        req = _mock_request("application/jsonl")
        assert _parse_accept(req) == "application/jsonl"

    def test_unknown_type_only_returns_none(self):
        req = _mock_request("application/xml")
        assert _parse_accept(req) is None

    def test_json_with_quality_prefix(self):
        # If application/json appears anywhere in the value, it matches
        req = _mock_request("application/json; q=0.9")
        assert _parse_accept(req) == "application/json"

    def test_json_in_mixed_accept(self):
        req = _mock_request("text/html, application/json")
        assert _parse_accept(req) == "application/json"


# ---------------------------------------------------------------------------
# handle_invoke_success — batch response
# ---------------------------------------------------------------------------


class TestHandleInvokeSuccessBatch:
    @pytest.mark.asyncio
    async def test_batch_no_accept_returns_json(self):
        req = _mock_request("")
        response = _batch_response()
        result = await handle_invoke_success(req, response)
        assert result.status_code == 200
        assert "application/json" in result.media_type

    @pytest.mark.asyncio
    async def test_batch_wildcard_returns_json(self):
        req = _mock_request("*/*")
        response = _batch_response()
        result = await handle_invoke_success(req, response)
        assert result.status_code == 200

    @pytest.mark.asyncio
    async def test_batch_accept_json_returns_json(self):
        req = _mock_request("application/json")
        response = _batch_response()
        result = await handle_invoke_success(req, response)
        assert result.status_code == 200
        assert "application/json" in result.media_type

    @pytest.mark.asyncio
    async def test_batch_accept_sse_returns_406(self):
        req = _mock_request("text/event-stream")
        response = _batch_response()
        result = await handle_invoke_success(req, response)
        assert result.status_code == 406
        body = json.loads(result.body)
        assert body["requested"] == "text/event-stream"
        assert "application/json" in body["supported"]

    @pytest.mark.asyncio
    async def test_batch_accept_ndjson_returns_406(self):
        req = _mock_request("application/x-ndjson")
        response = _batch_response()
        result = await handle_invoke_success(req, response)
        assert result.status_code == 406

    @pytest.mark.asyncio
    async def test_batch_accept_jsonl_returns_406(self):
        req = _mock_request("application/jsonl")
        response = _batch_response()
        result = await handle_invoke_success(req, response)
        assert result.status_code == 406

    @pytest.mark.asyncio
    async def test_raw_value_wrapped_as_batch_json(self):
        req = _mock_request("")
        result = await handle_invoke_success(req, "raw output")
        assert result.status_code == 200
        assert "application/json" in result.media_type


# ---------------------------------------------------------------------------
# handle_invoke_success — stream response
# ---------------------------------------------------------------------------


class TestHandleInvokeSuccessStream:
    @pytest.mark.asyncio
    async def test_stream_no_accept_returns_ndjson(self):
        req = _mock_request("")
        response = _stream_response()
        result = await handle_invoke_success(req, response)
        assert result.status_code == 200
        assert "application/x-ndjson" in result.media_type

    @pytest.mark.asyncio
    async def test_stream_wildcard_returns_ndjson(self):
        req = _mock_request("*/*")
        response = _stream_response()
        result = await handle_invoke_success(req, response)
        assert result.status_code == 200
        assert "application/x-ndjson" in result.media_type

    @pytest.mark.asyncio
    async def test_stream_accept_sse_returns_sse(self):
        req = _mock_request("text/event-stream")
        response = _stream_response()
        result = await handle_invoke_success(req, response)
        assert result.status_code == 200
        assert "text/event-stream" in result.media_type

    @pytest.mark.asyncio
    async def test_stream_accept_ndjson_returns_ndjson(self):
        req = _mock_request("application/x-ndjson")
        response = _stream_response()
        result = await handle_invoke_success(req, response)
        assert result.status_code == 200
        assert "application/x-ndjson" in result.media_type

    @pytest.mark.asyncio
    async def test_stream_accept_jsonl_returns_ndjson_bytes(self):
        req = _mock_request("application/jsonl")
        response = _stream_response()
        result = await handle_invoke_success(req, response)
        # jsonl is an alias — reuses ndjson wire format
        assert result.status_code == 200

    @pytest.mark.asyncio
    async def test_stream_accept_json_returns_406(self):
        req = _mock_request("application/json")
        response = _stream_response()
        result = await handle_invoke_success(req, response)
        assert result.status_code == 406
        body = json.loads(result.body)
        assert body["requested"] == "application/json"
        assert any(t in STREAM_MEDIA_TYPES for t in body["supported"])


# ---------------------------------------------------------------------------
# _make_not_acceptable_response — body structure
# ---------------------------------------------------------------------------


class TestMakeNotAcceptableResponse:
    def test_batch_406_contains_required_fields(self):
        response = _batch_response()
        result = _make_not_acceptable_response("text/event-stream", response)
        assert result.status_code == 406
        body = json.loads(result.body)
        assert "detail" in body
        assert body["requested"] == "text/event-stream"
        assert isinstance(body["supported"], list)
        assert "application/json" in body["supported"]

    def test_stream_406_contains_required_fields(self):
        response = _stream_response()
        result = _make_not_acceptable_response("application/json", response)
        assert result.status_code == 406
        body = json.loads(result.body)
        assert body["requested"] == "application/json"
        assert all(t in STREAM_MEDIA_TYPES for t in body["supported"])

    def test_406_includes_trace_id_when_present(self):
        response = _batch_response()
        response.trace_id = "abc123"
        result = _make_not_acceptable_response("text/event-stream", response)
        body = json.loads(result.body)
        assert body["trace_id"] == "abc123"

    def test_406_omits_trace_id_when_absent(self):
        response = _batch_response()
        result = _make_not_acceptable_response("text/event-stream", response)
        body = json.loads(result.body)
        assert "trace_id" not in body


# ---------------------------------------------------------------------------
# Media type set sanity checks
# ---------------------------------------------------------------------------


class TestMediaTypeSets:
    def test_batch_and_stream_disjoint(self):
        assert BATCH_MEDIA_TYPES.isdisjoint(STREAM_MEDIA_TYPES)

    def test_supported_is_union(self):
        assert SUPPORTED_MEDIA_TYPES == BATCH_MEDIA_TYPES | STREAM_MEDIA_TYPES

    def test_json_is_batch(self):
        assert "application/json" in BATCH_MEDIA_TYPES

    def test_streaming_types_in_stream(self):
        for t in ("text/event-stream", "application/x-ndjson", "application/jsonl"):
            assert t in STREAM_MEDIA_TYPES
