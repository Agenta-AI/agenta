"""Unit tests for detached (fire-and-forget) workflow invoke.

Covers the streaming "return on the first record" semantics of
``_stream_service_started`` and the ``invoke_workflow_detached`` wrapper. The httpx
stream is mocked so no live runner/service is needed; the key assertion is that the
call returns after the FIRST NDJSON record WITHOUT draining the rest.
"""

from types import SimpleNamespace
from unittest.mock import AsyncMock, patch
from uuid import uuid4

import pytest

from oss.src.core.workflows.service import WorkflowsService
from oss.src.core.workflows.types import WorkflowDetachedStartFailed


class _FakeStreamResponse:
    """Mimics the httpx streaming response context manager.

    ``lines`` is the NDJSON body; ``consumed`` records how many lines the caller
    actually pulled, so a test can assert the stream was NOT drained.
    """

    def __init__(self, *, status_code=200, lines=None, headers=None):
        self.status_code = status_code
        self._lines = lines or []
        self.headers = headers or {}
        self.consumed = 0

    async def __aenter__(self):
        return self

    async def __aexit__(self, *args):
        return False

    async def aread(self):
        return b"error-body"

    async def aiter_lines(self):
        for line in self._lines:
            self.consumed += 1
            yield line


class _FakeAsyncClient:
    def __init__(self, response):
        self._response = response

    async def __aenter__(self):
        return self

    async def __aexit__(self, *args):
        return False

    def stream(self, *args, **kwargs):
        return self._response


def _service() -> WorkflowsService:
    return WorkflowsService(workflows_dao=AsyncMock())


async def test_stream_service_started_returns_after_first_record_without_draining():
    response = _FakeStreamResponse(
        lines=[
            '{"kind": "event", "type": "message_start", "id": "m1"}',
            '{"kind": "event", "type": "message_delta", "id": "m1", "delta": "hi"}',
            '{"kind": "result"}',
        ],
        headers={"x-ag-trace-id": "tr-1", "x-ag-span-id": "sp-1"},
    )

    with patch("httpx.AsyncClient", return_value=_FakeAsyncClient(response)):
        result = await _service()._stream_service_started(
            url="http://svc/invoke",
            credentials="Secret tok",
            payload={"x": 1},
            run_id="run-abc",
        )

    assert result.run_id == "run-abc"
    assert result.accepted is True
    assert result.trace_id == "tr-1"
    assert result.span_id == "sp-1"
    # Only the FIRST record was consumed — the stream was not drained to completion.
    assert response.consumed == 1


async def test_stream_service_started_prefers_run_id_from_first_record():
    response = _FakeStreamResponse(
        lines=['{"kind": "event", "run_id": "run-from-wire", "type": "x"}'],
    )
    with patch("httpx.AsyncClient", return_value=_FakeAsyncClient(response)):
        result = await _service()._stream_service_started(
            url="http://svc/invoke",
            credentials="Secret tok",
            payload={},
            run_id="run-minted",
        )
    assert result.run_id == "run-from-wire"


async def test_stream_service_started_raises_on_empty_stream():
    response = _FakeStreamResponse(lines=[])
    with patch("httpx.AsyncClient", return_value=_FakeAsyncClient(response)):
        with pytest.raises(WorkflowDetachedStartFailed):
            await _service()._stream_service_started(
                url="http://svc/invoke",
                credentials="Secret tok",
                payload={},
                run_id="run-x",
            )


async def test_stream_service_started_raises_on_http_error():
    response = _FakeStreamResponse(status_code=500, lines=[])
    with patch("httpx.AsyncClient", return_value=_FakeAsyncClient(response)):
        with pytest.raises(WorkflowDetachedStartFailed):
            await _service()._stream_service_started(
                url="http://svc/invoke",
                credentials="Secret tok",
                payload={},
                run_id="run-x",
            )


async def test_invoke_workflow_detached_returns_run_id_and_threads_meta():
    svc = _service()
    project_id = uuid4()
    user_id = uuid4()

    # Stub the shared prelude so no DB/token signing is needed.
    svc._prepare_invoke = AsyncMock(return_value=("Secret tok", "http://svc"))

    captured = {}

    async def _fake_stream(*, url, credentials, payload, run_id):
        captured["url"] = url
        captured["payload"] = payload
        captured["run_id"] = run_id
        from oss.src.core.workflows.dtos import WorkflowServiceDetachedResponse

        return WorkflowServiceDetachedResponse(run_id=run_id, accepted=True)

    svc._stream_service_started = _fake_stream

    from agenta.sdk.decorators.running import WorkflowServiceRequest

    request = WorkflowServiceRequest(references={"workflow": {"slug": "wf-1"}})

    result = await svc.invoke_workflow_detached(
        project_id=project_id,
        user_id=user_id,
        request=request,
        run_id="run-fixed",
    )

    assert result.run_id == "run-fixed"
    assert captured["url"] == "http://svc/invoke"
    # The coordination ids are threaded onto the request meta (Foundation B handoff).
    assert captured["payload"]["meta"]["run_id"] == "run-fixed"
    assert captured["payload"]["meta"]["project_id"] == str(project_id)


async def test_invoke_workflow_detached_raises_when_no_service_url():
    svc = _service()
    svc._prepare_invoke = AsyncMock(return_value=("Secret tok", None))

    from agenta.sdk.decorators.running import WorkflowServiceRequest
    from oss.src.core.workflows.types import WorkflowServiceUrlMissing

    with pytest.raises(WorkflowServiceUrlMissing):
        await svc.invoke_workflow_detached(
            project_id=uuid4(),
            user_id=uuid4(),
            request=WorkflowServiceRequest(),
        )


async def test_invoke_workflow_batch_still_returns_400_when_no_service_url():
    """Regression: the batch path keeps its external behavior (400 body, no raise)."""
    svc = _service()
    svc._prepare_invoke = AsyncMock(return_value=("Secret tok", None))

    from agenta.sdk.decorators.running import WorkflowServiceRequest

    result = await svc.invoke_workflow(
        project_id=uuid4(),
        user_id=uuid4(),
        request=WorkflowServiceRequest(),
    )
    assert result.status.code == 400


def test_dispatch_fn_injected_into_both_consumers():
    """The entrypoint wires a real dispatch_fn into both detached consumers."""
    from oss.src.tasks.asyncio.sessions.interactions_worker import InteractionsWorker
    from oss.src.tasks.asyncio.triggers.dispatcher import TriggersDispatcher

    async def _dispatch(*, project_id, user_id, request):
        return "run-1"

    worker = InteractionsWorker(
        workflows_service=SimpleNamespace(),
        interactions_service=SimpleNamespace(),
        dispatch_fn=_dispatch,
    )
    dispatcher = TriggersDispatcher(
        triggers_dao=SimpleNamespace(),
        workflows_service=SimpleNamespace(),
        dispatch_fn=_dispatch,
    )
    assert worker._dispatch_fn is _dispatch
    assert dispatcher._dispatch_fn is _dispatch
