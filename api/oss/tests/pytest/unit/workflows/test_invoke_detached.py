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
from oss.src.utils.env import env


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


@pytest.mark.parametrize(
    "line",
    [
        "not-json",
        "[]",
        '{"kind": "result", "result": {"ok": false, "error": "rejected"}}',
        '{"kind": "result"}',
        # The service wire's own failure frame (an agenta `error` event).
        '{"type": "error", "data": {"type": "error", "message": "no key", "code": "auth"}}',
    ],
)
async def test_stream_service_started_rejects_failure_or_malformed_first_record(line):
    response = _FakeStreamResponse(lines=[line])
    with patch("httpx.AsyncClient", return_value=_FakeAsyncClient(response)):
        with pytest.raises(WorkflowDetachedStartFailed):
            await _service()._stream_service_started(
                url="http://svc/invoke",
                credentials="Secret tok",
                payload={},
                run_id="run-x",
                strict_first_record=True,
            )


async def test_stream_service_started_keeps_legacy_best_effort_for_ordinary_trigger():
    response = _FakeStreamResponse(lines=["not-json"])
    with patch("httpx.AsyncClient", return_value=_FakeAsyncClient(response)):
        result = await _service()._stream_service_started(
            url="http://svc/invoke",
            credentials="Secret tok",
            payload={},
            run_id="run-x",
        )

    assert result.accepted is True
    assert result.run_id == "run-x"


@pytest.mark.parametrize(
    "line",
    [
        # The record sequence a durable continuation really produced (browser pass,
        # 2026-09-04 17:35Z, session d99f32ae / command 01a06d7d): the runner admitted the
        # continuation and its first event was a `tool_call`. The DEPLOYED SERVICE re-frames
        # every runner record as an agenta event, `{"type", "data"}` — there is no `kind` on
        # that wire, and reading the first frame as a runner record called every one of those
        # deliveries unreachable while the turn ran to completion underneath the card.
        '{"type": "tool_call", "data": {"type": "tool_call", "id": "t1", "name": "Bash"}}',
        '{"type": "interaction_response", "data": {"type": "interaction_response"}}',
        '{"type": "message", "data": {"type": "message", "text": "ok"}}',
        # An unrecognised record is a start, not a failure: only an explicit failure frame is.
        '{"kind": "unknown"}',
        '{"type": "error_recovered", "data": {}}',
    ],
)
async def test_stream_service_started_accepts_a_service_event_frame_as_the_start(line):
    response = _FakeStreamResponse(lines=[line, '{"type": "done", "data": {}}'])
    with patch("httpx.AsyncClient", return_value=_FakeAsyncClient(response)):
        result = await _service()._stream_service_started(
            url="http://svc/invoke",
            credentials="Secret tok",
            payload={},
            run_id="run-x",
            strict_first_record=True,
        )
    assert result.accepted is True
    assert result.run_id == "run-x"
    assert response.consumed == 1


async def test_stream_service_started_reports_a_runner_refusal_verbatim():
    """Case (b) of the same browser pass, command 01a06d7a.

    The runner refuses a continuation it cannot prove it owns and writes
    ``{"kind": "result", ok: false}``. Where a deployment forwards that record verbatim the
    caller must surface the reason, not report a start.
    """
    refusal = (
        '{"kind": "result", "result": {"ok": false, "error": '
        '"Continuation could not establish alive ownership; retry delivery."}}'
    )
    response = _FakeStreamResponse(lines=[refusal])
    with patch("httpx.AsyncClient", return_value=_FakeAsyncClient(response)):
        with pytest.raises(WorkflowDetachedStartFailed) as failure:
            await _service()._stream_service_started(
                url="http://svc/invoke",
                credentials="Secret tok",
                payload={},
                run_id="run-x",
                strict_first_record=True,
            )
    assert "alive ownership" in str(failure.value)


async def test_stream_service_started_reports_an_empty_stream_as_a_failed_start():
    """The same refusal as it actually reaches the API through the SDK service.

    The SDK turns the runner's ``ok: false`` result into an exception inside an ASGI response
    whose 200 is already committed, so the service closes the stream having written nothing.
    """
    response = _FakeStreamResponse(lines=[])
    with patch("httpx.AsyncClient", return_value=_FakeAsyncClient(response)):
        with pytest.raises(WorkflowDetachedStartFailed) as failure:
            await _service()._stream_service_started(
                url="http://svc/invoke",
                credentials="Secret tok",
                payload={},
                run_id="run-x",
                strict_first_record=True,
            )
    assert "closed the stream" in str(failure.value)


async def test_stream_service_started_accepts_success_result_record():
    response = _FakeStreamResponse(
        lines=['{"kind": "result", "result": {"ok": true}}'],
    )
    with patch("httpx.AsyncClient", return_value=_FakeAsyncClient(response)):
        result = await _service()._stream_service_started(
            url="http://svc/invoke",
            credentials="Secret tok",
            payload={},
            run_id="run-x",
        )
    assert result.accepted is True


async def test_invoke_workflow_detached_returns_run_id_and_threads_meta():
    svc = _service()
    project_id = uuid4()
    user_id = uuid4()

    # Stub the shared prelude so no DB/token signing is needed.
    svc._prepare_invoke = AsyncMock(return_value=("Secret tok", "http://svc"))

    captured = {}

    async def _fake_stream(*, url, credentials, payload, run_id, strict_first_record):
        captured["url"] = url
        captured["payload"] = payload
        captured["run_id"] = run_id
        captured["strict_first_record"] = strict_first_record
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
    assert captured["strict_first_record"] is False


async def test_invoke_workflow_detached_enables_strict_handshake_for_control_command():
    svc = _service()
    svc._prepare_invoke = AsyncMock(return_value=("Secret tok", "http://svc"))
    captured = {}

    async def _fake_stream(*, url, credentials, payload, run_id, strict_first_record):
        captured["strict_first_record"] = strict_first_record
        from oss.src.core.workflows.dtos import WorkflowServiceDetachedResponse

        return WorkflowServiceDetachedResponse(run_id=run_id, accepted=True)

    svc._stream_service_started = _fake_stream

    from agenta.sdk.decorators.running import WorkflowServiceRequest

    await svc.invoke_workflow_detached(
        project_id=uuid4(),
        user_id=uuid4(),
        request=WorkflowServiceRequest(meta={"control_command_id": str(uuid4())}),
        run_id="run-control",
    )

    assert captured["strict_first_record"] is True


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


async def test_ordinary_session_invoke_redelivers_recoverable_continuation(monkeypatch):
    monkeypatch.setattr(env.agenta.sessions, "durable_approvals", True)
    svc = _service()
    resume = AsyncMock(return_value=True)
    svc.set_session_continuation_resumer(resume)
    svc._prepare_invoke = AsyncMock()

    from agenta.sdk.decorators.running import WorkflowServiceRequest

    project_id = uuid4()
    result = await svc.invoke_workflow(
        project_id=project_id,
        user_id=uuid4(),
        request=WorkflowServiceRequest(session_id="session-1"),
    )

    assert result.status.code == 409
    resume.assert_awaited_once_with(project_id=project_id, session_id="session-1")
    svc._prepare_invoke.assert_not_awaited()


async def test_control_continuation_bypasses_ordinary_send_recovery_hook(monkeypatch):
    monkeypatch.setattr(env.agenta.sessions, "durable_approvals", True)
    svc = _service()
    resume = AsyncMock(return_value=True)
    svc.set_session_continuation_resumer(resume)
    svc._prepare_invoke = AsyncMock(return_value=("Secret tok", None))

    from agenta.sdk.decorators.running import WorkflowServiceRequest

    result = await svc.invoke_workflow(
        project_id=uuid4(),
        user_id=uuid4(),
        request=WorkflowServiceRequest(
            session_id="session-1", meta={"control_command_id": "command-1"}
        ),
    )

    assert result.status.code == 400
    resume.assert_not_awaited()


def test_dispatch_fn_injected_into_both_consumers():
    """The entrypoint wires a real dispatch_fn into both detached consumers."""
    from oss.src.tasks.asyncio.sessions.interactions_dispatcher import (
        InteractionsDispatcher,
    )
    from oss.src.tasks.asyncio.triggers.dispatcher import TriggersDispatcher

    async def _dispatch(*, project_id, user_id, request):
        return "run-1"

    worker = InteractionsDispatcher(
        workflows_service=SimpleNamespace(),
        interactions_service=SimpleNamespace(),
        dispatch_fn=_dispatch,
    )
    dispatcher = TriggersDispatcher(
        triggers_dao=SimpleNamespace(),
        session_claims_dao=SimpleNamespace(),
        workflows_service=SimpleNamespace(),
        dispatch_fn=_dispatch,
    )
    assert worker._dispatch_fn is _dispatch
    assert dispatcher._dispatch_fn is _dispatch
