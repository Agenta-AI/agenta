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

from agenta.sdk.contexts.running import RunningContext
from agenta.sdk.middlewares.running.normalizer import NormalizerMiddleware
from agenta.sdk.models.workflows import (
    WorkflowRequestData,
    WorkflowServiceRequest,
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


class TestRequestNormalization:
    @pytest.mark.asyncio
    async def test_parameters_none_is_normalized_to_empty_dict(self):
        def handler(parameters):
            return parameters

        request = WorkflowServiceRequest(
            data=WorkflowRequestData(parameters=None),
        )

        mw = NormalizerMiddleware()
        kwargs = await mw._normalize_request(request, handler)

        assert kwargs["parameters"] == {}
        assert request.data.parameters == {}

    @pytest.mark.asyncio
    async def test_parameters_dict_is_preserved(self):
        def handler(parameters):
            return parameters

        request = WorkflowServiceRequest(
            data=WorkflowRequestData(parameters={"correct_answer_key": "answer"}),
        )

        mw = NormalizerMiddleware()
        kwargs = await mw._normalize_request(request, handler)

        assert kwargs["parameters"] == {"correct_answer_key": "answer"}

    @pytest.mark.asyncio
    async def test_session_id_is_passed_to_explicit_handler_argument(self):
        def handler(session_id):
            return session_id

        request = WorkflowServiceRequest(
            session_id="sess_request",
            data=WorkflowRequestData(),
        )

        mw = NormalizerMiddleware()
        kwargs = await mw._normalize_request(request, handler)

        assert kwargs["session_id"] == "sess_request"

    @pytest.mark.asyncio
    async def test_session_id_is_not_added_to_var_kwargs(self):
        def handler(**kwargs):
            return kwargs

        request = WorkflowServiceRequest(
            session_id="sess_request",
            data=WorkflowRequestData(inputs={"prompt": "hi"}),
        )

        mw = NormalizerMiddleware()
        kwargs = await mw._normalize_request(request, handler)

        assert "session_id" not in kwargs

    @pytest.mark.asyncio
    async def test_call_resolves_provided_session_id_before_handler(self, monkeypatch):
        import agenta as ag

        monkeypatch.setattr(ag, "tracing", None)
        seen = {}

        def handler(request):
            seen["session_id"] = request.session_id
            return {"ok": True}

        request = WorkflowServiceRequest(
            session_id="sess_request",
            data=WorkflowRequestData(),
        )

        token = RunningContext.set(RunningContext(handler=handler))
        try:
            response = await NormalizerMiddleware()(request, lambda req: None)
        finally:
            RunningContext.reset(token)

        assert seen["session_id"] == "sess_request"
        assert response.session_id == "sess_request"

    @pytest.mark.asyncio
    async def test_call_mints_session_id_before_handler_when_omitted(self, monkeypatch):
        import agenta as ag

        monkeypatch.setattr(ag, "tracing", None)
        seen = {}

        def handler(session_id):
            seen["session_id"] = session_id
            return {"ok": True}

        request = WorkflowServiceRequest(data=WorkflowRequestData())

        token = RunningContext.set(RunningContext(handler=handler))
        try:
            response = await NormalizerMiddleware()(request, lambda req: None)
        finally:
            RunningContext.reset(token)

        sid = seen["session_id"]
        assert isinstance(sid, str)
        assert len(sid) == 32
        assert all(c in "0123456789abcdef" for c in sid)
        assert request.session_id == sid
        assert response.session_id == sid

    @pytest.mark.asyncio
    async def test_call_stores_agent_id_from_running_context_revision(
        self, monkeypatch
    ):
        import agenta as ag

        class _TracingSpy:
            def __init__(self):
                self.store_session_calls = []
                self.store_agent_calls = []

            def store_session(self, session_id):
                self.store_session_calls.append(session_id)

            def store_agent(self, agent_id):
                self.store_agent_calls.append(agent_id)

        spy = _TracingSpy()
        monkeypatch.setattr(ag, "tracing", spy, raising=False)

        def handler(request):
            return {"ok": True}

        request = WorkflowServiceRequest(
            session_id="sess_agent_test",
            data=WorkflowRequestData(),
        )

        token = RunningContext.set(
            RunningContext(
                handler=handler,
                revision={"artifact_id": "workflow-abc"},
            )
        )
        try:
            await NormalizerMiddleware()(request, lambda req: None)
        finally:
            RunningContext.reset(token)

        assert spy.store_agent_calls == ["workflow-abc"]
        assert spy.store_session_calls == ["sess_agent_test"]

    @pytest.mark.asyncio
    async def test_call_does_not_store_agent_id_when_revision_missing(
        self, monkeypatch
    ):
        import agenta as ag

        class _TracingSpy:
            def __init__(self):
                self.store_agent_calls = []

            def store_session(self, session_id):
                pass

            def store_agent(self, agent_id):
                self.store_agent_calls.append(agent_id)

        spy = _TracingSpy()
        monkeypatch.setattr(ag, "tracing", spy, raising=False)

        def handler(request):
            return {"ok": True}

        request = WorkflowServiceRequest(data=WorkflowRequestData())

        token = RunningContext.set(RunningContext(handler=handler))
        try:
            await NormalizerMiddleware()(request, lambda req: None)
        finally:
            RunningContext.reset(token)

        assert spy.store_agent_calls == []


class TestResolveAgentId:
    def test_resolves_artifact_id_from_revision(self):
        ctx = RunningContext(revision={"artifact_id": "wf-1"})
        assert NormalizerMiddleware._resolve_agent_id(ctx) == "wf-1"

    def test_falls_back_to_workflow_id_alias(self):
        ctx = RunningContext(revision={"workflow_id": "wf-2"})
        assert NormalizerMiddleware._resolve_agent_id(ctx) == "wf-2"

    def test_none_when_revision_missing(self):
        ctx = RunningContext()
        assert NormalizerMiddleware._resolve_agent_id(ctx) is None

    def test_none_when_revision_not_a_dict(self):
        ctx = RunningContext.model_construct(revision="not-a-dict")
        assert NormalizerMiddleware._resolve_agent_id(ctx) is None

    def test_none_when_artifact_id_absent(self):
        ctx = RunningContext(revision={"id": "rev-1"})
        assert NormalizerMiddleware._resolve_agent_id(ctx) is None


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
