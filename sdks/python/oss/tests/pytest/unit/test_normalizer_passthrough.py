"""
Unit tests for NormalizerMiddleware._normalize_response in
sdk/agenta/sdk/middlewares/running/normalizer.py.

Tests verify that:
- async generators  -> WorkflowServiceStreamResponse (no accumulation)
- sync generators   -> WorkflowServiceStreamResponse (no accumulation)
- already-stream    -> WorkflowServiceStreamResponse (pass-through)
- already-batch     -> WorkflowServiceBatchResponse  (pass-through)
- plain values      -> WorkflowServiceBatchResponse  (wrapped)
- awaitables        -> awaited, then wrapped as batch
"""

import pytest

from agenta.sdk.middlewares.running.normalizer import NormalizerMiddleware
from agenta.sdk.models.workflows import (
    WorkflowServiceBatchResponse,
    WorkflowServiceStreamResponse,
    WorkflowServiceResponseData,
)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


async def _agen(*items):
    for item in items:
        yield item


def _sgen(*items):
    yield from items


async def _collect(stream_response: WorkflowServiceStreamResponse):
    chunks = []
    async for chunk in stream_response.generator():
        chunks.append(chunk)
    return chunks


# ---------------------------------------------------------------------------
# Async generator -> WorkflowServiceStreamResponse
# ---------------------------------------------------------------------------


class TestAsyncGenerator:
    @pytest.mark.asyncio
    async def test_returns_stream_response(self):
        mw = NormalizerMiddleware()
        result = await mw._normalize_response(_agen("a", "b", "c"))
        assert isinstance(result, WorkflowServiceStreamResponse)

    @pytest.mark.asyncio
    async def test_chunks_are_preserved(self):
        mw = NormalizerMiddleware()
        result = await mw._normalize_response(_agen("x", "y"))
        chunks = await _collect(result)
        assert chunks == ["x", "y"]

    @pytest.mark.asyncio
    async def test_does_not_accumulate(self):
        """Generator is not consumed at wrap time — first chunk arrives lazily."""
        consumed = []

        async def tracking_gen():
            consumed.append("started")
            yield "chunk"

        mw = NormalizerMiddleware()
        result = await mw._normalize_response(tracking_gen())
        # Not consumed yet
        assert consumed == []
        # Consume now
        await _collect(result)
        assert consumed == ["started"]


# ---------------------------------------------------------------------------
# Sync generator -> WorkflowServiceStreamResponse
# ---------------------------------------------------------------------------


class TestSyncGenerator:
    @pytest.mark.asyncio
    async def test_returns_stream_response(self):
        mw = NormalizerMiddleware()
        result = await mw._normalize_response(_sgen(1, 2, 3))
        assert isinstance(result, WorkflowServiceStreamResponse)

    @pytest.mark.asyncio
    async def test_chunks_are_preserved(self):
        mw = NormalizerMiddleware()
        result = await mw._normalize_response(_sgen("p", "q"))
        chunks = await _collect(result)
        assert chunks == ["p", "q"]


# ---------------------------------------------------------------------------
# Already-stream pass-through
# ---------------------------------------------------------------------------


class TestStreamPassThrough:
    @pytest.mark.asyncio
    async def test_existing_stream_response_returned_as_is(self):
        async def gen():
            yield "hello"

        original = WorkflowServiceStreamResponse(generator=gen)
        mw = NormalizerMiddleware()
        result = await mw._normalize_response(original)
        assert isinstance(result, WorkflowServiceStreamResponse)

    @pytest.mark.asyncio
    async def test_existing_stream_chunks_intact(self):
        async def gen():
            yield "a"
            yield "b"

        original = WorkflowServiceStreamResponse(generator=gen)
        mw = NormalizerMiddleware()
        result = await mw._normalize_response(original)
        chunks = await _collect(result)
        assert chunks == ["a", "b"]


# ---------------------------------------------------------------------------
# Already-batch pass-through
# ---------------------------------------------------------------------------


class TestBatchPassThrough:
    @pytest.mark.asyncio
    async def test_existing_batch_response_returned_as_is(self):
        original = WorkflowServiceBatchResponse(
            data=WorkflowServiceResponseData(outputs="done")
        )
        mw = NormalizerMiddleware()
        result = await mw._normalize_response(original)
        assert isinstance(result, WorkflowServiceBatchResponse)

    @pytest.mark.asyncio
    async def test_existing_batch_data_preserved(self):
        original = WorkflowServiceBatchResponse(
            data=WorkflowServiceResponseData(outputs="the answer")
        )
        mw = NormalizerMiddleware()
        result = await mw._normalize_response(original)
        assert result.data.outputs == "the answer"


# ---------------------------------------------------------------------------
# Plain values -> WorkflowServiceBatchResponse
# ---------------------------------------------------------------------------


class TestPlainValues:
    @pytest.mark.asyncio
    async def test_string_wrapped_as_batch(self):
        mw = NormalizerMiddleware()
        result = await mw._normalize_response("hello world")
        assert isinstance(result, WorkflowServiceBatchResponse)
        assert result.data.outputs == "hello world"

    @pytest.mark.asyncio
    async def test_dict_wrapped_as_batch(self):
        mw = NormalizerMiddleware()
        result = await mw._normalize_response({"key": "value"})
        assert isinstance(result, WorkflowServiceBatchResponse)
        assert result.data.outputs == {"key": "value"}

    @pytest.mark.asyncio
    async def test_none_wrapped_as_batch(self):
        mw = NormalizerMiddleware()
        result = await mw._normalize_response(None)
        assert isinstance(result, WorkflowServiceBatchResponse)
        assert result.data.outputs is None

    @pytest.mark.asyncio
    async def test_integer_wrapped_as_batch(self):
        mw = NormalizerMiddleware()
        result = await mw._normalize_response(42)
        assert isinstance(result, WorkflowServiceBatchResponse)
        assert result.data.outputs == 42


# ---------------------------------------------------------------------------
# Awaitables -> awaited then wrapped
# ---------------------------------------------------------------------------


class TestAwaitables:
    @pytest.mark.asyncio
    async def test_coroutine_result_wrapped_as_batch(self):
        async def coro():
            return "coro result"

        mw = NormalizerMiddleware()
        result = await mw._normalize_response(coro())
        assert isinstance(result, WorkflowServiceBatchResponse)
        assert result.data.outputs == "coro result"

    @pytest.mark.asyncio
    async def test_coroutine_returning_none_wrapped_as_batch(self):
        async def coro():
            return None

        mw = NormalizerMiddleware()
        result = await mw._normalize_response(coro())
        assert isinstance(result, WorkflowServiceBatchResponse)
        assert result.data.outputs is None
