"""
Unit tests for HTTP content negotiation in sdk/agenta/sdk/decorators/routing.py.

Tests cover:
- _parse_accept: mapping Accept header values to supported media types
- handle_invoke_success: strict batch/stream matching, 406 on mismatch
- _make_not_acceptable_response: 406 body structure
"""

import json
from types import SimpleNamespace
from unittest.mock import MagicMock

import pytest

from agenta.sdk.decorators.routing import (
    BATCH_MEDIA_TYPES,
    STREAM_MEDIA_TYPES,
    SUPPORTED_MEDIA_TYPES,
    _parse_accept,
    _make_not_acceptable_response,
    apply_invoke_prelude,
    handle_invoke_success,
)
from agenta.sdk.models.workflows import (
    WorkflowInvokeRequest,
    WorkflowServiceBatchResponse,
    WorkflowServiceStreamResponse,
    WorkflowServiceResponseData,
)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _mock_request(accept: str = "", messages_format: str = "") -> MagicMock:
    req = MagicMock()
    req.state = SimpleNamespace()
    req.headers = MagicMock()

    def _get(key, default=""):
        if key == "accept" and accept:
            return accept
        if key == "x-ag-messages-format" and messages_format:
            return messages_format
        return default

    req.headers.get = _get
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


async def _drain_streaming_response(response) -> str:
    chunks = []
    async for chunk in response.body_iterator:
        if isinstance(chunk, bytes):
            chunks.append(chunk.decode())
        else:
            chunks.append(chunk)
    return "".join(chunks)


def _sse_parts(body: str):
    parts = []
    for block in body.split("\n\n"):
        if not block.startswith("data: "):
            continue
        payload = block.removeprefix("data: ")
        if payload and payload != "[DONE]":
            parts.append(json.loads(payload))
    return parts


def _message(role: str, message_id=None):
    message = {
        "role": role,
        "parts": [{"type": "text", "text": f"{role} text"}],
    }
    if message_id is not None:
        message["id"] = message_id
    return message


def _invoke_request_with_messages(messages) -> WorkflowInvokeRequest:
    return WorkflowInvokeRequest(data={"inputs": {"messages": messages}})


# ---------------------------------------------------------------------------
# Vercel continuation message id
# ---------------------------------------------------------------------------


def test_prelude_captures_vercel_last_assistant_message_id():
    req = _mock_request(messages_format="vercel")
    request = _invoke_request_with_messages(
        [_message("user", "user-1"), _message("assistant", "resume-msg-1")]
    )

    apply_invoke_prelude(req, request)

    assert req.state.ag_continuation_message_id == "resume-msg-1"


@pytest.mark.parametrize(
    "messages",
    [
        [_message("assistant", "assistant-1"), _message("user", "user-1")],
        [{"role": "assistant", "parts": [{"type": "text", "text": "paused"}]}],
        [_message("assistant", "")],
        [
            {
                "role": "assistant",
                "id": None,
                "parts": [{"type": "text", "text": "paused"}],
            }
        ],
    ],
)
def test_prelude_skips_vercel_messages_without_continuation_id(messages):
    req = _mock_request(messages_format="vercel")
    request = _invoke_request_with_messages(messages)

    apply_invoke_prelude(req, request)

    assert not hasattr(req.state, "ag_continuation_message_id")


def test_prelude_does_not_capture_non_vercel_request():
    req = _mock_request()
    request = _invoke_request_with_messages([_message("assistant", "resume-msg-1")])

    apply_invoke_prelude(req, request)

    assert not hasattr(req.state, "ag_continuation_message_id")


@pytest.mark.asyncio
async def test_handle_invoke_success_vercel_stream_uses_continuation_message_id():
    req = _mock_request("text/event-stream", messages_format="vercel")
    req.state.ag_continuation_message_id = "resume-msg-1"
    response = _stream_response([{"type": "message", "data": {"text": "hi"}}])
    response.trace_id = "trace-1"

    result = await handle_invoke_success(req, response)
    parts = _sse_parts(await _drain_streaming_response(result))

    assert parts[0]["type"] == "start"
    assert parts[0]["messageId"] == "resume-msg-1"


@pytest.mark.asyncio
async def test_handle_invoke_success_vercel_stream_mints_trace_id_without_continuation():
    req = _mock_request("text/event-stream", messages_format="vercel")
    response = _stream_response([{"type": "message", "data": {"text": "hi"}}])
    response.trace_id = "trace-1"

    result = await handle_invoke_success(req, response)
    parts = _sse_parts(await _drain_streaming_response(result))

    assert parts[0]["type"] == "start"
    assert parts[0]["messageId"] == "msg-trace-1"


@pytest.mark.asyncio
async def test_handle_invoke_success_vercel_json_uses_continuation_message_id():
    req = _mock_request("application/json", messages_format="vercel")
    req.state.ag_continuation_message_id = "resume-msg-1"
    response = _batch_response(
        {"messages": [{"role": "assistant", "content": "reply"}]}
    )

    result = await handle_invoke_success(req, response)
    body = json.loads(result.body)

    messages = body["data"]["outputs"]["messages"]
    assert messages[-1]["role"] == "assistant"
    assert messages[-1]["id"] == "resume-msg-1"


@pytest.mark.asyncio
async def test_handle_invoke_success_vercel_json_stamps_last_assistant_before_trailing_user():
    req = _mock_request("application/json", messages_format="vercel")
    req.state.ag_continuation_message_id = "resume-msg-1"
    response = _batch_response(
        {
            "messages": [
                {"role": "assistant", "content": "reply"},
                {"role": "user", "content": "follow-up"},
            ]
        }
    )

    result = await handle_invoke_success(req, response)
    body = json.loads(result.body)

    messages = body["data"]["outputs"]["messages"]
    assert messages[0]["role"] == "assistant"
    assert messages[0]["id"] == "resume-msg-1"
    assert messages[1]["role"] == "user"
    assert messages[1]["id"] == "msg-2"


@pytest.mark.asyncio
async def test_handle_invoke_success_vercel_json_does_not_stamp_user_message():
    req = _mock_request("application/json", messages_format="vercel")
    req.state.ag_continuation_message_id = "resume-msg-1"
    response = _batch_response({"messages": [{"role": "user", "content": "reply"}]})

    result = await handle_invoke_success(req, response)
    body = json.loads(result.body)

    messages = body["data"]["outputs"]["messages"]
    assert messages[-1]["role"] == "user"
    assert messages[-1]["id"] == "msg-1"


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
