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

import json
from typing import Dict, List, Optional
from uuid import uuid4

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
