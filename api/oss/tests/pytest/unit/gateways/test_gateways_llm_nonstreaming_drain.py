"""OR33: a non-streaming relay must record its call, with usage, before it answers.

The layer seam this covers is why neither side's suite caught the defect. The service's own
tests drain the body by comprehension, which is the contract the service honours; the proxy's
tests run against a mock service, so they never reach the recording. Between the two, the real
proxy takes ONE chunk from the body generator and stops — and the record used to live in a
`finally` that only runs once an abandoned generator is finalised, at garbage collection, with
`result.usage` still unset because the adapter assigns it on the statement after its yield.

So these cases compose the real service, the real relay adapter and the real proxy over a mock
upstream transport: nothing is stubbed between the request and the bytes.

Nothing running: `httpx.MockTransport` intercepts every request, no real socket.
"""

import asyncio
import json
from typing import AsyncIterator, Dict, List, Optional
from uuid import uuid4

import anyio
import httpx
import pytest
from starlette.requests import Request

from oss.src.apis.fastapi.gateways.llms.proxy import LLMGatewayProxy
from oss.src.core.gateways.dtos import GatewayEndpointNamespace
from oss.src.core.gateways.llms.dtos import (
    LLMEndpoint,
    LLMDeploymentKind,
    LLMEndpointData,
    LLMEndpointRoute,
    LLMEndpointSettings,
    LLMModelFilter,
    LLMProtocol,
)
from oss.src.core.gateways.llms.providers.passthrough.adapter import RelayLLMAdapter
from oss.src.core.gateways.llms.registry import LLMUpstreamRegistry
from oss.src.core.gateways.policy.audit import build_gateway_call_attributes
from oss.src.utils.context import (
    AuthContext,
    AuthScope,
    SecretCredentials,
    reset_auth_context,
    set_auth_context,
)

from oss.tests.pytest.unit.gateways.test_gateways_llm_service import (
    _MockLlmEndpointsDAO,
    _MockPolicy,
    _MockResolver,
    _secret,
    _service,
)

_UPSTREAM = "https://upstream.example/v1"

# One non-streaming answer per protocol, with the usage field that protocol actually uses.
_ANSWERS = {
    LLMProtocol.CHAT_COMPLETIONS: (
        {"model": "gpt-4o", "messages": []},
        {
            "id": "chatcmpl-1",
            "choices": [{"message": {"role": "assistant", "content": "hi"}}],
            "usage": {"prompt_tokens": 11, "completion_tokens": 7},
        },
    ),
    LLMProtocol.RESPONSES: (
        {"model": "gpt-4o", "input": "hello"},
        {
            "id": "resp-1",
            "output": [],
            "usage": {"input_tokens": 11, "output_tokens": 7},
        },
    ),
    LLMProtocol.MESSAGES: (
        {"model": "gpt-4o", "messages": [], "max_tokens": 16},
        {
            "id": "msg-1",
            "content": [],
            "usage": {"input_tokens": 11, "output_tokens": 7},
        },
    ),
}


# The three custom-namespace entrypoints, one per protocol: each is its own route on the
# proxy, and the defect lived in the shared `_relay` all three reach.
_ENTRYPOINTS = {
    LLMProtocol.CHAT_COMPLETIONS: lambda proxy, request: proxy.chat_completions_custom(
        request, "acme"
    ),
    LLMProtocol.RESPONSES: lambda proxy, request: proxy.responses_custom(
        request, "acme"
    ),
    LLMProtocol.MESSAGES: lambda proxy, request: proxy.messages_custom(request, "acme"),
}


def _row() -> LLMEndpoint:
    return LLMEndpoint(
        id=uuid4(),
        slug="acme",
        provider_key="openai",
        deployment_kind=LLMDeploymentKind.CUSTOM,
        namespace=GatewayEndpointNamespace.CUSTOM,
        secret_id=uuid4(),
        data=LLMEndpointData(
            route=LLMEndpointRoute(base_url=_UPSTREAM),
            models=LLMModelFilter(allowlist=["gpt-4o"]),
            settings=LLMEndpointSettings(),
        ),
    )


def _request(*, body: bytes) -> Request:
    scope = {
        "type": "http",
        "method": "POST",
        "path": "/gateways/llms/custom/acme/v1/chat/completions",
        "headers": [(b"content-type", b"application/json")],
        "query_string": b"",
    }

    async def receive():
        return {"type": "http.request", "body": body, "more_body": False}

    return Request(scope, receive)


class _CountingTransport(httpx.MockTransport):
    """Answers the upstream and remembers how many requests it served."""

    def __init__(self, payload: Dict, *, chunks: Optional[List[bytes]] = None):
        self.requests: List[httpx.Request] = []
        body = json.dumps(payload).encode()
        self.expected = b"".join(chunks) if chunks else body

        def handler(request: httpx.Request) -> httpx.Response:
            self.requests.append(request)
            return httpx.Response(
                200,
                headers={"content-type": "application/json"},
                content=self.expected,
            )

        super().__init__(handler)


def _proxy(transport: httpx.MockTransport, policy: _MockPolicy) -> LLMGatewayProxy:
    dao = _MockLlmEndpointsDAO()
    dao.rows_by_slug["acme"] = _row()
    adapter = RelayLLMAdapter(client=httpx.AsyncClient(transport=transport))
    service = _service(
        dao=dao,
        resolver=_MockResolver(secret=_secret()),
        registry=LLMUpstreamRegistry(adapters={"relay": adapter}),
        policy=policy,
    )
    return LLMGatewayProxy(llm_gateway_service=service)


def _auth():
    return set_auth_context(
        AuthContext(
            credentials=SecretCredentials(value="test-token"),
            scope=AuthScope(
                organization_id=uuid4(),
                workspace_id=uuid4(),
                project_id=uuid4(),
                user_id=uuid4(),
            ),
        )
    )


@pytest.mark.asyncio
@pytest.mark.parametrize("protocol", list(_ANSWERS))
async def test_a_non_streaming_relay_records_its_usage_before_it_answers(protocol):
    request_payload, answer = _ANSWERS[protocol]
    transport = _CountingTransport(answer)
    policy = _MockPolicy(allowed=True)
    proxy = _proxy(transport, policy)

    token = _auth()
    try:
        response = await _ENTRYPOINTS[protocol](
            proxy, _request(body=json.dumps(request_payload).encode())
        )
    finally:
        reset_auth_context(token)

    assert response.status_code == 200
    # Byte-preserving: the caller gets the upstream's answer unchanged.
    assert response.body == transport.expected

    # The call is recorded by the time the response exists, not whenever the interpreter
    # gets around to finalising an abandoned generator.
    assert len(policy.record_calls) == 1
    outcome = policy.record_calls[0][3]
    assert outcome.status_code == 200
    # `GatewayUsage` counts input and output tokens; it has no cached-token field today, so
    # a cached count has nowhere to land and is not asserted.
    assert outcome.usage is not None, "the meter would see no usage at all"
    assert outcome.usage.calls == 1
    assert outcome.usage.input_tokens == 11
    assert outcome.usage.output_tokens == 7


@pytest.mark.asyncio
async def test_a_chunked_upstream_answer_reaches_the_caller_whole():
    """The relay adapter coalesces with `aread()`, so the caller sees one body either way.

    The service-level twin in `test_gateways_llm_service.py` is what pins the join for an
    adapter that does not coalesce; this one pins that the real relay path is unaffected by
    how the upstream chose to frame its answer.
    """
    _, answer = _ANSWERS[LLMProtocol.CHAT_COMPLETIONS]
    body = json.dumps(answer).encode()
    transport = _CountingTransport(answer, chunks=[body[:20], body[20:]])
    policy = _MockPolicy(allowed=True)
    proxy = _proxy(transport, policy)

    token = _auth()
    try:
        response = await proxy.chat_completions_custom(
            _request(body=json.dumps({"model": "gpt-4o", "messages": []}).encode()),
            "acme",
        )
    finally:
        reset_auth_context(token)

    assert response.body == body
    assert json.loads(response.body)["usage"]["prompt_tokens"] == 11


@pytest.mark.asyncio
async def test_a_streaming_relay_still_records_only_after_the_caller_drains():
    """The streaming contract is unchanged: Starlette drains it, and the record rides that."""
    transport = _CountingTransport({"ignored": True})
    policy = _MockPolicy(allowed=True)
    proxy = _proxy(transport, policy)

    token = _auth()
    try:
        response = await proxy.chat_completions_custom(
            _request(
                body=json.dumps(
                    {"model": "gpt-4o", "messages": [], "stream": True}
                ).encode()
            ),
            "acme",
        )
    finally:
        reset_auth_context(token)

    assert policy.record_calls == []
    assert [chunk async for chunk in response.body_iterator] == [transport.expected]
    assert len(policy.record_calls) == 1


# --- OR48: a cancelled stream is still metered, and its upstream still closed ---- #


class _SseStream(httpx.AsyncByteStream):
    """An upstream SSE body that can park mid-stream, and remembers being closed.

    Parking is what lets a case cancel the consumer at the one moment that matters: after
    the caller has seen bytes and before the upstream is finished sending them, which is
    what a browser tab closing mid-answer looks like from here.

    Closing suspends, because closing a real connection does. A cleanup that reaches no
    suspension point finishes inline even inside a cancelled scope, so a fake that closes
    instantly would pass whether the cleanup is protected or not.
    """

    def __init__(self, chunks: List[bytes], *, park_after: Optional[int] = None):
        self._chunks = chunks
        self._park_after = park_after
        self.parked = asyncio.Event()
        self.resume = asyncio.Event()
        self.closed = False

    async def __aiter__(self) -> AsyncIterator[bytes]:
        for index, chunk in enumerate(self._chunks):
            if self._park_after is not None and index == self._park_after:
                self.parked.set()
                await self.resume.wait()
            yield chunk

    async def aclose(self) -> None:
        await asyncio.sleep(0)
        self.closed = True


class _PublishingPolicy(_MockPolicy):
    """A policy whose `record` suspends, as the real one does when it publishes."""

    async def record(self, *, scope, target, decision, outcome, run_id=None):
        await asyncio.sleep(0)
        await super().record(
            scope=scope,
            target=target,
            decision=decision,
            outcome=outcome,
            run_id=run_id,
        )


def _sse_transport(stream: _SseStream, *, requests: List[httpx.Request]):
    def handler(request: httpx.Request) -> httpx.Response:
        requests.append(request)
        return httpx.Response(
            200,
            headers={"content-type": "text/event-stream"},
            stream=stream,
        )

    return httpx.MockTransport(handler)


async def _until(predicate, *, turns: int = 50) -> None:
    """Give the loop a turn at a time until `predicate` holds, or the turns run out.

    A shielded cleanup finishes on the loop rather than in the cancelled caller, so a case
    that asserts on it has to let the loop run. Bounded, so a cleanup that never runs fails
    the assertion that follows instead of hanging the suite.
    """
    for _ in range(turns):
        if predicate():
            return
        await asyncio.sleep(0)


@pytest.mark.asyncio
async def test_a_stream_cancelled_mid_answer_is_still_recorded_and_closed():
    """OR48: a client disconnect cancels the task, and the cleanup used to die with it.

    Both halves are asserted, because the bug cost both: the call vanished from the audit
    trail, and the upstream response was never closed, so its connection leaked until the
    pool timed it out.
    """
    stream = _SseStream(
        [b'data: {"choices":[{"delta":{"content":"hi"}}]}\n\n', b"data: [DONE]\n\n"],
        park_after=1,
    )
    requests: List[httpx.Request] = []
    policy = _PublishingPolicy(allowed=True)
    proxy = _proxy(_sse_transport(stream, requests=requests), policy)

    token = _auth()
    try:
        response = await proxy.chat_completions_custom(
            _request(
                body=json.dumps(
                    {"model": "gpt-4o", "messages": [], "stream": True}
                ).encode()
            ),
            "acme",
        )
    finally:
        reset_auth_context(token)

    seen: List[bytes] = []

    async def consume() -> None:
        async for chunk in response.body_iterator:
            seen.append(chunk)

    # Cancelled the way Starlette cancels it: a `StreamingResponse` drains the body inside
    # an anyio task group and cancels that group's scope when the client disconnects. The
    # distinction matters — an anyio cancel scope re-delivers cancellation to every await
    # inside it until the task leaves, so a cleanup that suspends cannot simply catch the
    # first CancelledError and carry on, which is why a plain `task.cancel()` would let
    # the unprotected cleanup finish and prove nothing.
    async with anyio.create_task_group() as disconnecting:
        disconnecting.start_soon(consume)
        await asyncio.wait_for(stream.parked.wait(), timeout=1)
        assert seen, "the caller should have read the first frame before the disconnect"
        disconnecting.cancel_scope.cancel()

    await _until(lambda: policy.record_calls and stream.closed)

    assert len(policy.record_calls) == 1, (
        "an aborted stream is still a call that happened"
    )
    assert policy.record_calls[0][3].status_code == 200
    assert stream.closed, "the upstream response was left open, leaking its connection"


@pytest.mark.asyncio
async def test_cancelling_a_stream_still_cancels_the_caller():
    """The shield must not swallow what it protects the cleanup from."""
    stream = _SseStream([b"data: {}\n\n", b"data: [DONE]\n\n"], park_after=1)
    requests: List[httpx.Request] = []
    policy = _PublishingPolicy(allowed=True)
    proxy = _proxy(_sse_transport(stream, requests=requests), policy)

    token = _auth()
    try:
        response = await proxy.chat_completions_custom(
            _request(
                body=json.dumps(
                    {"model": "gpt-4o", "messages": [], "stream": True}
                ).encode()
            ),
            "acme",
        )
    finally:
        reset_auth_context(token)

    async def consume() -> None:
        async for _ in response.body_iterator:
            pass

    consumer = asyncio.create_task(consume())
    await asyncio.wait_for(stream.parked.wait(), timeout=1)
    consumer.cancel()

    with pytest.raises(asyncio.CancelledError):
        await consumer
    assert consumer.cancelled(), "the cancellation was absorbed by the cleanup"


# --- OR49: a streamed call records the usage the upstream reported --------------- #


# One streamed answer per protocol, each carrying its usage where that protocol puts it.
# The numbers are the same everywhere so a case reads as a protocol difference, not a
# number difference.
_STREAM_INPUT_TOKENS = 11
_STREAM_OUTPUT_TOKENS = 7

# A Responses stream's usage rides its terminal event, together with the whole response
# object — padded here past the 8 KiB tail the drain used to scan backwards through, which
# is the reason that scan could not be trusted to find it.
_RESPONSES_COMPLETED = {
    "type": "response.completed",
    "response": {
        "id": "resp-1",
        "output": [{"type": "output_text", "text": "x" * 9000}],
        "usage": {
            "input_tokens": _STREAM_INPUT_TOKENS,
            "output_tokens": _STREAM_OUTPUT_TOKENS,
        },
    },
}

_MESSAGES_START = {
    "type": "message_start",
    "message": {
        "id": "msg-1",
        "role": "assistant",
        "content": [],
        # At the HEAD of the stream: the tail scan never saw this frame at all.
        "usage": {"input_tokens": _STREAM_INPUT_TOKENS, "output_tokens": 0},
    },
}

_MESSAGES_DELTA = {
    "type": "message_delta",
    "delta": {"stop_reason": "end_turn"},
    "usage": {"output_tokens": _STREAM_OUTPUT_TOKENS},
}

_CHAT_USAGE_FRAME = {
    "id": "chatcmpl-1",
    "choices": [],
    "usage": {
        "prompt_tokens": _STREAM_INPUT_TOKENS,
        "completion_tokens": _STREAM_OUTPUT_TOKENS,
    },
}


def _event(name: str, payload: Dict) -> bytes:
    return f"event: {name}\ndata: {json.dumps(payload)}\n\n".encode()


def _chat_stream_chunks(*, include_usage: bool) -> List[bytes]:
    """What OpenAI streams back, which carries usage only when the request asked for it."""
    chunks = [b'data: {"id":"chatcmpl-1","choices":[{"delta":{"content":"hi"}}]}\n\n']
    if include_usage:
        chunks.append(f"data: {json.dumps(_CHAT_USAGE_FRAME)}\n\n".encode())
    chunks.append(b"data: [DONE]\n\n")
    return chunks


# Chat Completions is the one door where usage is the CALLER's request to make: OpenAI
# streams it only for a request carrying `stream_options.include_usage`, and the gateway
# relays the body it was given rather than adding the option itself.
_STREAM_REQUESTS = {
    LLMProtocol.CHAT_COMPLETIONS: {
        "model": "gpt-4o",
        "messages": [],
        "stream": True,
        "stream_options": {"include_usage": True},
    },
    LLMProtocol.RESPONSES: {"model": "gpt-4o", "input": "hello", "stream": True},
    LLMProtocol.MESSAGES: {
        "model": "gpt-4o",
        "messages": [],
        "max_tokens": 16,
        "stream": True,
    },
}


def _stream_chunks(protocol: LLMProtocol, *, request: httpx.Request) -> List[bytes]:
    if protocol == LLMProtocol.RESPONSES:
        return [
            _event("response.created", {"type": "response.created"}),
            _event("response.completed", _RESPONSES_COMPLETED),
        ]
    if protocol == LLMProtocol.MESSAGES:
        return [
            _event("message_start", _MESSAGES_START),
            _event(
                "content_block_delta",
                {"type": "content_block_delta", "delta": {"text": "hi"}},
            ),
            _event("message_delta", _MESSAGES_DELTA),
            _event("message_stop", {"type": "message_stop"}),
        ]
    asked = json.loads(request.content).get("stream_options") or {}
    return _chat_stream_chunks(include_usage=asked.get("include_usage") is True)


def _protocol_stream_transport(
    protocol: LLMProtocol, *, requests: List[httpx.Request]
) -> httpx.MockTransport:
    def handler(request: httpx.Request) -> httpx.Response:
        requests.append(request)
        return httpx.Response(
            200,
            headers={"content-type": "text/event-stream"},
            stream=_SseStream(_stream_chunks(protocol, request=request)),
        )

    return httpx.MockTransport(handler)


@pytest.mark.asyncio
@pytest.mark.parametrize("protocol", list(_STREAM_REQUESTS))
async def test_a_streamed_call_records_the_usage_the_upstream_reported(protocol):
    """OR49: every streamed call used to meter as zero, on all three protocols."""
    requests: List[httpx.Request] = []
    policy = _MockPolicy(allowed=True)
    proxy = _proxy(_protocol_stream_transport(protocol, requests=requests), policy)

    token = _auth()
    try:
        response = await _ENTRYPOINTS[protocol](
            proxy, _request(body=json.dumps(_STREAM_REQUESTS[protocol]).encode())
        )
    finally:
        reset_auth_context(token)

    relayed = b"".join([chunk async for chunk in response.body_iterator])
    assert relayed, "the caller still reads the upstream's frames"

    assert len(policy.record_calls) == 1
    scope, target, decision, outcome = policy.record_calls[0]
    assert outcome.usage is not None, "the meter would see no usage at all"
    assert outcome.usage.calls == 1
    assert outcome.usage.input_tokens == _STREAM_INPUT_TOKENS
    assert outcome.usage.output_tokens == _STREAM_OUTPUT_TOKENS

    # And the record the meter actually reads carries the same numbers: until OR49 the
    # audit event dropped every one of them.
    attributes = build_gateway_call_attributes(
        scope=scope, target=target, decision=decision, outcome=outcome
    )
    assert attributes["calls"] == 1
    assert attributes["input_tokens"] == _STREAM_INPUT_TOKENS
    assert attributes["output_tokens"] == _STREAM_OUTPUT_TOKENS


@pytest.mark.asyncio
async def test_a_streamed_chat_call_that_asked_for_no_usage_is_relayed_and_recorded_as_such():
    """The other side of the case above: no option added, and no usage invented.

    A call that reported nothing must not be recorded as a call that cost zero — the audit
    record carries no token counts at all, so the two are told apart by the reader rather
    than by a zero nobody measured.
    """
    requests: List[httpx.Request] = []
    policy = _MockPolicy(allowed=True)
    proxy = _proxy(
        _protocol_stream_transport(LLMProtocol.CHAT_COMPLETIONS, requests=requests),
        policy,
    )
    sent = {"model": "gpt-4o", "messages": [], "stream": True}

    token = _auth()
    try:
        response = await proxy.chat_completions_custom(
            _request(body=json.dumps(sent).encode()), "acme"
        )
    finally:
        reset_auth_context(token)

    relayed = b"".join([chunk async for chunk in response.body_iterator])

    assert json.loads(requests[0].content) == sent
    assert b"stream_options" not in requests[0].content
    assert relayed == b"".join(_chat_stream_chunks(include_usage=False))

    scope, target, decision, outcome = policy.record_calls[0]
    assert outcome.usage is None, (
        "an unmetered call must not read as one that cost zero"
    )
    attributes = build_gateway_call_attributes(
        scope=scope, target=target, decision=decision, outcome=outcome
    )
    assert "input_tokens" not in attributes
    assert "output_tokens" not in attributes
    assert "calls" not in attributes
