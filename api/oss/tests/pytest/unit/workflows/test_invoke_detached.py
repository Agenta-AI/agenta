"""Unit tests for detached (fire-and-forget) workflow invoke.

Covers the streaming "return on the first record" semantics of
``_stream_service_started`` and the ``invoke_workflow_detached`` wrapper. The httpx
stream is mocked so no live runner/service is needed; the key assertion is that the
call returns after the FIRST NDJSON record WITHOUT draining the rest.
"""

from types import SimpleNamespace
from unittest.mock import AsyncMock, patch
from uuid import uuid4

import httpx
import pytest

from oss.src.core.workflows.service import WorkflowsService
from oss.src.core.workflows.types import (
    WorkflowDetachedStartFailed,
    WorkflowDetachedStartNeverSent,
)
from oss.src.utils.env import env


class _FakeStreamResponse:
    """Mimics the httpx streaming response context manager.

    ``lines`` is the NDJSON body; ``consumed`` records how many lines the caller
    actually pulled, so a test can assert the stream was NOT drained.
    """

    def __init__(
        self, *, status_code=200, lines=None, headers=None, body=b"error-body"
    ):
        self.status_code = status_code
        self._lines = lines or []
        self.headers = httpx.Headers(headers or {})
        self._body = body
        self.consumed = 0

    async def __aenter__(self):
        return self

    async def __aexit__(self, *args):
        return False

    async def aread(self):
        return self._body

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


async def test_invoke_workflow_detached_enables_explicit_strict_start():
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
        request=WorkflowServiceRequest(),
        run_id="run-strict",
        strict_start=True,
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


# The responses a dead workflow service really produces. `AGENTA_SERVICES_URL` is a public origin
# in front of a reverse proxy in every topology this repo ships (compose, Railway, Helm, cloud),
# so stopping the container does not give the API a connection error. The proxy answers.
_NEXT_JS_CATCH_ALL_404 = (
    404,
    {"content-type": "text/html; charset=utf-8", "x-powered-by": "Next.js"},
    b"<!DOCTYPE html><html><head><title>404: This page could not be found",
)
_PROXY_NO_BACKEND_503 = (
    503,
    {"content-type": "text/plain; charset=utf-8"},
    b"Service Unavailable",
)


@pytest.mark.parametrize(
    ("status_code", "headers", "body"),
    [_NEXT_JS_CATCH_ALL_404, _PROXY_NO_BACKEND_503],
)
async def test_a_response_that_never_reached_the_service_is_marked_never_sent(
    status_code, headers, body
):
    response = _FakeStreamResponse(status_code=status_code, headers=headers, body=body)
    with patch("httpx.AsyncClient", return_value=_FakeAsyncClient(response)):
        with pytest.raises(WorkflowDetachedStartNeverSent):
            await _service()._stream_service_started(
                url="http://svc/invoke",
                credentials="Secret tok",
                payload={},
                run_id="run-x",
            )


@pytest.mark.parametrize(
    ("status_code", "headers"),
    [
        # A gateway that forwarded and then gave up on the answer. The run may have been taken.
        (502, {"content-type": "text/html"}),
        (504, {"content-type": "text/html"}),
        (500, {"content-type": "application/json"}),
        (429, {"content-type": "application/json"}),
        # The service's own answers. Anything it builds carries `x-ag-version`, so a 404 or a
        # 503 with that header came from the service and the status stops being proof.
        (404, {"x-ag-version": "unknown", "content-type": "application/json"}),
        (503, {"x-ag-version": "0.119.1", "x-ag-trace-id": "tr-1"}),
    ],
)
async def test_an_ambiguous_response_stays_an_ordinary_start_failure(
    status_code, headers
):
    response = _FakeStreamResponse(status_code=status_code, headers=headers)
    with patch("httpx.AsyncClient", return_value=_FakeAsyncClient(response)):
        with pytest.raises(WorkflowDetachedStartFailed) as raised:
            await _service()._stream_service_started(
                url="http://svc/invoke",
                credentials="Secret tok",
                payload={},
                run_id="run-x",
            )

    # Not redundant: `WorkflowDetachedStartNeverSent` subclasses the type `pytest.raises` is
    # catching, so this is the assertion that tells the two apart.
    assert not isinstance(raised.value, WorkflowDetachedStartNeverSent)


async def test_a_never_sent_response_is_still_an_ordinary_start_failure_to_old_handlers():
    status_code, headers, body = _NEXT_JS_CATCH_ALL_404
    response = _FakeStreamResponse(status_code=status_code, headers=headers, body=body)
    with patch("httpx.AsyncClient", return_value=_FakeAsyncClient(response)):
        with pytest.raises(WorkflowDetachedStartFailed) as raised:
            await _service()._stream_service_started(
                url="http://svc/invoke",
                credentials="Secret tok",
                payload={},
                run_id="run-x",
            )

    assert "404" in str(raised.value)


class _RaisingAsyncClient:
    """A client whose `stream` fails at the transport, the way a dead address does."""

    def __init__(self, error):
        self._error = error

    async def __aenter__(self):
        return self

    async def __aexit__(self, *args):
        return False

    def stream(self, *args, **kwargs):
        raise self._error


_URL = "http://svc/invoke"


@pytest.mark.parametrize(
    "error",
    [
        httpx.ConnectError("refused", request=httpx.Request("POST", _URL)),
        httpx.ConnectTimeout("never connected", request=httpx.Request("POST", _URL)),
        httpx.PoolTimeout("no connection", request=httpx.Request("POST", _URL)),
        httpx.UnsupportedProtocol(
            "unknown scheme", request=httpx.Request("POST", _URL)
        ),
        # httpx binds no request when it fails before building one.
        httpx.ConnectError("refused"),
        httpx.InvalidURL("not a url"),
    ],
)
async def test_a_transport_failure_on_the_request_we_sent_is_never_sent(error):
    with patch("httpx.AsyncClient", return_value=_RaisingAsyncClient(error)):
        with pytest.raises(WorkflowDetachedStartNeverSent):
            await _service()._stream_service_started(
                url=_URL,
                credentials="Secret tok",
                payload={},
                run_id="run-x",
            )


@pytest.mark.parametrize(
    "attempted",
    [
        "http://elsewhere/invoke",
        "https://svc/invoke",
        "http://svc/invoke/redirected",
    ],
)
async def test_a_transport_failure_on_a_redirect_hop_is_not_never_sent(attempted):
    """`follow_redirects=True` means the failing request may not be the one we addressed.

    Something answered the first hop with a 3xx, and a proxy that redirects a POST may have
    forwarded it, so this proves nothing and the original error propagates unclassified.
    """
    error = httpx.ConnectError("refused", request=httpx.Request("POST", attempted))
    with patch("httpx.AsyncClient", return_value=_RaisingAsyncClient(error)):
        with pytest.raises(httpx.ConnectError) as raised:
            await _service()._stream_service_started(
                url=_URL,
                credentials="Secret tok",
                payload={},
                run_id="run-x",
            )

    assert raised.value is error


@pytest.mark.parametrize(
    "url",
    [
        # The same address written the way httpx normalizes it, and the way a config file does.
        "http://svc:80/invoke",
        "http://SVC/invoke",
        "http://svc/services/agent/v0/invoke",
    ],
)
async def test_the_hop_check_reads_an_equivalent_url_as_the_same_request(url):
    """A default port or an uppercase host must not read as a redirect.

    It would keep the claim on a plain connection refusal, which is the failure this whole
    classification exists to release.
    """
    error = httpx.ConnectError("refused", request=httpx.Request("POST", url))
    with patch("httpx.AsyncClient", return_value=_RaisingAsyncClient(error)):
        with pytest.raises(WorkflowDetachedStartNeverSent):
            await _service()._stream_service_started(
                url=url,
                credentials="Secret tok",
                payload={},
                run_id="run-x",
            )


@pytest.mark.parametrize(
    "error",
    [
        httpx.ReadTimeout("the answer was lost", request=httpx.Request("POST", _URL)),
        httpx.WriteError("part-way sent", request=httpx.Request("POST", _URL)),
        httpx.RemoteProtocolError(
            "closed mid-response", request=httpx.Request("POST", _URL)
        ),
    ],
)
async def test_a_transport_failure_with_bytes_on_the_wire_is_not_never_sent(error):
    with patch("httpx.AsyncClient", return_value=_RaisingAsyncClient(error)):
        with pytest.raises(httpx.HTTPError) as raised:
            await _service()._stream_service_started(
                url=_URL,
                credentials="Secret tok",
                payload={},
                run_id="run-x",
            )

    assert raised.value is error


def _through(transport: httpx.MockTransport):
    """Build the real `httpx.AsyncClient` the code asks for, with a transport underneath.

    Everything else about the client stays as production builds it, `follow_redirects=True`
    included, so httpx's own redirect machinery runs.
    """
    real_client = httpx.AsyncClient

    def build(*args, **kwargs):
        return real_client(*args, transport=transport, **kwargs)

    return patch("httpx.AsyncClient", build)


_FIRST_HOP = "http://svc/invoke"
_SECOND_HOP = "http://redirected-elsewhere/invoke"


async def test_a_real_redirect_to_an_unreachable_hop_is_not_never_sent():
    """The premise the whole classification rests on, driven through httpx rather than assumed.

    Every other case here binds the request to the exception by hand, which is the very thing
    under test. Here the transport raises an UNBOUND `ConnectError` and httpx attributes it, so
    if httpx ever stopped binding the failing hop's request this test fails and the others do
    not. A 307 keeps the method and body, which is the redirect that can carry a POST onward.
    """
    hops = []

    def handle(request: httpx.Request) -> httpx.Response:
        hops.append(str(request.url))
        if str(request.url) == _FIRST_HOP:
            return httpx.Response(307, headers={"location": _SECOND_HOP})
        raise httpx.ConnectError("connection refused")

    with _through(httpx.MockTransport(handle)):
        with pytest.raises(httpx.ConnectError) as raised:
            await _service()._stream_service_started(
                url=_FIRST_HOP,
                credentials="Secret tok",
                payload={},
                run_id="run-x",
            )

    assert hops == [_FIRST_HOP, _SECOND_HOP]
    assert not isinstance(raised.value, WorkflowDetachedStartNeverSent)
    # httpx bound the hop that failed, not the one we addressed. That is what the rule reads.
    assert str(raised.value.request.url) == _SECOND_HOP


async def test_a_real_first_hop_refusal_is_never_sent():
    """The same path with no redirect, so the two differ only in what httpx attributed."""

    def handle(request: httpx.Request) -> httpx.Response:
        raise httpx.ConnectError("connection refused")

    with _through(httpx.MockTransport(handle)):
        with pytest.raises(WorkflowDetachedStartNeverSent):
            await _service()._stream_service_started(
                url=_FIRST_HOP,
                credentials="Secret tok",
                payload={},
                run_id="run-x",
            )


async def test_a_real_redirect_chain_that_exhausts_its_hops_is_not_never_sent():
    """A redirect loop ends in `TooManyRedirects`, which is not a never-sent type."""

    def handle(request: httpx.Request) -> httpx.Response:
        return httpx.Response(307, headers={"location": str(request.url)})

    with _through(httpx.MockTransport(handle)):
        with pytest.raises(httpx.TooManyRedirects) as raised:
            await _service()._stream_service_started(
                url=_FIRST_HOP,
                credentials="Secret tok",
                payload={},
                run_id="run-x",
            )

    assert not isinstance(raised.value, WorkflowDetachedStartNeverSent)


async def test_a_read_failure_part_way_through_the_stream_is_not_never_sent():
    """The realistic mid-stream shape: 200 committed, then the body dies.

    Raised from inside `aiter_lines()` rather than from the call that opens the stream, which no
    other case here reaches. The frame is deliberately incomplete: this function returns on the
    first whole record, so a failure after one would never be seen.
    """

    async def content():
        yield b'{"type": "message", "data"'  # no newline: no record yet
        raise httpx.ReadTimeout("the stream stalled after it started")

    def handle(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, content=content())

    with _through(httpx.MockTransport(handle)):
        with pytest.raises(httpx.ReadTimeout) as raised:
            await _service()._stream_service_started(
                url=_FIRST_HOP,
                credentials="Secret tok",
                payload={},
                run_id="run-x",
                strict_first_record=True,
            )

    assert not isinstance(raised.value, WorkflowDetachedStartNeverSent)
