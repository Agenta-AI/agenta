"""Unit tests for `RelayLLMAdapter`.

Nothing running: httpx.MockTransport intercepts every request, no real socket.

The relay now dials the literal address the egress guard checked and carries the registered
authority in `Host` (`core/gateways/egress.py`, OD26), so an outbound request's URL host is
an IP address. The routing tests below therefore assert on :func:`_routed_url`, which puts
the authority back; the pin itself is asserted in `test_gateways_egress.py`.
"""

import json
from typing import Optional
from unittest.mock import AsyncMock, patch

import httpx
import pytest

from oss.src.core.gateways.llms.dtos import (
    LLMCallContext,
    LLMDeploymentKind,
    LLMEndpointSettings,
    LLMProtocol,
    LLMResolvedRoute,
)
from oss.src.core.gateways.llms.providers.passthrough.adapter import (
    RelayLLMAdapter,
)
from oss.src.core.gateways.llms.types import LLMUpstreamError
from oss.src.core.gateways.policy.dtos import (
    SecretOwner,
    SecretOwnerKind,
    ResolvedSecret,
    SecretOrigin,
)
from oss.src.core.secrets.dtos import (
    CustomProviderDTO,
    CustomProviderSettingsDTO,
    SecretResponseDTO,
    StandardProviderDTO,
    StandardProviderSettingsDTO,
)
from oss.src.core.secrets.enums import (
    CustomProviderKind,
    SecretKind,
    StandardProviderKind,
)
from oss.src.core.shared.dtos import Header


def _routed_url(request: httpx.Request) -> str:
    """The URL the relay composed, with the egress pin undone."""
    return f"{request.url.scheme}://{request.headers['host']}{request.url.raw_path.decode()}"


def _route(
    *,
    base_url: Optional[str] = "https://upstream.example/v1",
    timeout_seconds: Optional[float] = None,
) -> LLMResolvedRoute:
    return LLMResolvedRoute(
        provider_key="openai",
        deployment_kind=LLMDeploymentKind.CUSTOM,
        model="gpt-4o",
        base_url=base_url,
        headers={"x-route": "1"},
        settings=LLMEndpointSettings(timeout_seconds=timeout_seconds),
    )


def _context(*, stream: bool = False) -> LLMCallContext:
    return LLMCallContext(model="gpt-4o", stream=stream)


def _body() -> bytes:
    return json.dumps(
        {"model": "gpt-4o", "messages": [{"role": "user", "content": "hi"}]}
    ).encode()


def _standard_secret(key: str = "sk-standard") -> ResolvedSecret:
    return ResolvedSecret(
        secret=SecretResponseDTO(
            kind=SecretKind.PROVIDER_KEY,
            data=StandardProviderDTO(
                kind=StandardProviderKind.OPENAI,
                provider=StandardProviderSettingsDTO(key=key),
            ),
            header=Header(name="openai"),
        ),
        owner=SecretOwner(kind=SecretOwnerKind.PROJECT),
        origin=SecretOrigin.VAULT,
    )


def _custom_secret(
    key: str = "sk-custom", extras: Optional[dict] = None
) -> ResolvedSecret:
    # SecretResponseDTO's own before-validator calls `.get()` on `data` ahead of
    # SecretDTO's model-instance-to-dict coercion, so a raw dict here (rather
    # than a CustomProviderDTO instance) sidesteps that ordering entirely.
    data = CustomProviderDTO(
        kind=CustomProviderKind.CUSTOM,
        provider=CustomProviderSettingsDTO(key=key, extras=extras),
        models=[],
    ).model_dump()
    return ResolvedSecret(
        secret=SecretResponseDTO(
            kind=SecretKind.CUSTOM_PROVIDER,
            data=data,
            header=Header(name="my-custom"),
        ),
        owner=SecretOwner(kind=SecretOwnerKind.PROJECT),
        origin=SecretOrigin.VAULT,
    )


def _adapter(handler) -> RelayLLMAdapter:
    transport = httpx.MockTransport(handler)
    return RelayLLMAdapter(client=httpx.AsyncClient(transport=transport))


async def _drain(body):
    return [chunk async for chunk in body]


@pytest.mark.asyncio
async def test_standard_provider_secret_injects_bearer_header():
    captured = {}

    def handler(request: httpx.Request) -> httpx.Response:
        captured["request"] = request
        return httpx.Response(200, json={"id": "x", "choices": []})

    adapter = _adapter(handler)
    await adapter.relay_chat_completion(
        route=_route(),
        secret=_standard_secret("sk-standard"),
        context=_context(),
        body=_body(),
        headers={},
    )

    assert captured["request"].headers["authorization"] == "Bearer sk-standard"


@pytest.mark.asyncio
async def test_custom_provider_secret_injects_bearer_and_leaves_extras_behind():
    captured = {}

    def handler(request: httpx.Request) -> httpx.Response:
        captured["request"] = request
        return httpx.Response(200, json={"id": "x", "choices": []})

    adapter = _adapter(handler)
    await adapter.relay_chat_completion(
        route=_route(),
        secret=_custom_secret("sk-custom", extras={"x-org-id": "org-1"}),
        context=_context(),
        body=_body(),
        headers={},
    )

    request = captured["request"]
    assert request.headers["authorization"] == "Bearer sk-custom"
    # A custom endpoint's extras are configuration; only its registered `headers` travel.
    assert "x-org-id" not in request.headers


@pytest.mark.asyncio
async def test_no_secret_sends_no_authorization_header():
    captured = {}

    def handler(request: httpx.Request) -> httpx.Response:
        captured["request"] = request
        return httpx.Response(200, json={"id": "x", "choices": []})

    adapter = _adapter(handler)
    await adapter.relay_chat_completion(
        route=_route(), secret=None, context=_context(), body=_body(), headers={}
    )

    assert "authorization" not in captured["request"].headers


@pytest.mark.asyncio
async def test_our_credentials_header_is_never_forwarded():
    captured = {}

    def handler(request: httpx.Request) -> httpx.Response:
        captured["request"] = request
        return httpx.Response(200, json={"id": "x", "choices": []})

    adapter = _adapter(handler)
    await adapter.relay_chat_completion(
        route=_route(),
        secret=None,
        context=_context(),
        body=_body(),
        headers={"X-AG-Credentials": "Secret caller-token"},
    )

    assert "x-ag-credentials" not in captured["request"].headers


@pytest.mark.asyncio
async def test_caller_authorization_never_reaches_the_upstream():
    """OR36: an endpoint's upstream credential comes from its registered secret, never from
    the caller. With no secret resolved the call still goes out — unauthenticated, which the
    upstream answers as it sees fit — but the caller's own token is not what authenticates
    it. `authorization` is not on the forward allowlist, so it is dropped either way."""
    captured = {}

    def handler(request: httpx.Request) -> httpx.Response:
        captured["request"] = request
        return httpx.Response(200, json={"id": "x", "choices": []})

    adapter = _adapter(handler)
    await adapter.relay_chat_completion(
        route=_route(),
        secret=None,
        context=_context(),
        body=_body(),
        headers={"authorization": "Bearer caller-subscription"},
    )

    assert "authorization" not in captured["request"].headers


@pytest.mark.asyncio
async def test_a_resolved_secret_overwrites_the_callers_authorization():
    """The other half of the same rule: when we do hold a secret, ours is what goes out.

    The caller's spelling is the lowercase one Starlette produces (OR37). Merged as plain
    dicts it survived beside the injected capital-A name and the upstream received two
    authorization values, so the header count is asserted, not just the value."""
    captured = {}

    def handler(request: httpx.Request) -> httpx.Response:
        captured["request"] = request
        return httpx.Response(200, json={"id": "x", "choices": []})

    adapter = _adapter(handler)
    await adapter.relay_chat_completion(
        route=_route(),
        secret=_standard_secret(key="sk-ours"),
        context=_context(),
        body=_body(),
        headers={"authorization": "Bearer caller-subscription"},
    )

    request = captured["request"]
    assert request.headers.get_list("authorization") == ["Bearer sk-ours"]


@pytest.mark.asyncio
async def test_outbound_url_is_base_url_plus_chat_completions():
    captured = {}

    def handler(request: httpx.Request) -> httpx.Response:
        captured["request"] = request
        return httpx.Response(200, json={"id": "x", "choices": []})

    adapter = _adapter(handler)
    await adapter.relay_chat_completion(
        route=_route(base_url="https://upstream.example/v1"),
        secret=None,
        context=_context(),
        body=_body(),
        headers={},
    )

    assert _routed_url(captured["request"]) == (
        "https://upstream.example/v1/chat/completions"
    )


@pytest.mark.asyncio
async def test_route_headers_merged_into_outbound():
    captured = {}

    def handler(request: httpx.Request) -> httpx.Response:
        captured["request"] = request
        return httpx.Response(200, json={"id": "x", "choices": []})

    adapter = _adapter(handler)
    await adapter.relay_chat_completion(
        route=_route(), secret=None, context=_context(), body=_body(), headers={}
    )

    assert captured["request"].headers["x-route"] == "1"


@pytest.mark.asyncio
async def test_request_body_bytes_reach_transport_unchanged():
    captured = {}

    def handler(request: httpx.Request) -> httpx.Response:
        captured["content"] = request.content
        return httpx.Response(200, json={"id": "x", "choices": []})

    adapter = _adapter(handler)
    body = _body()
    await adapter.relay_chat_completion(
        route=_route(), secret=None, context=_context(), body=body, headers={}
    )

    assert captured["content"] == body


@pytest.mark.asyncio
async def test_timeout_raises_llm_upstream_error():
    def handler(request: httpx.Request) -> httpx.Response:
        raise httpx.ReadTimeout("timed out", request=request)

    adapter = _adapter(handler)

    with pytest.raises(LLMUpstreamError) as excinfo:
        await adapter.relay_chat_completion(
            route=_route(),
            secret=None,
            context=_context(),
            body=_body(),
            headers={},
        )

    assert excinfo.value.status_code is None


@pytest.mark.asyncio
async def test_connection_failure_raises_llm_upstream_error_never_something_else():
    def handler(request: httpx.Request) -> httpx.Response:
        raise httpx.ConnectError("connection refused", request=request)

    adapter = _adapter(handler)

    with pytest.raises(LLMUpstreamError):
        await adapter.relay_chat_completion(
            route=_route(),
            secret=None,
            context=_context(),
            body=_body(),
            headers={},
        )


@pytest.mark.asyncio
async def test_non_timeout_5xx_raises_llm_upstream_error_with_status_code():
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(503, text="upstream broke")

    adapter = _adapter(handler)

    with pytest.raises(LLMUpstreamError) as excinfo:
        await adapter.relay_chat_completion(
            route=_route(),
            secret=None,
            context=_context(),
            body=_body(),
            headers={},
        )

    assert excinfo.value.status_code == 503


@pytest.mark.asyncio
async def test_4xx_response_passes_through_untouched():
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(400, json={"error": {"message": "bad request"}})

    adapter = _adapter(handler)
    result = await adapter.relay_chat_completion(
        route=_route(), secret=None, context=_context(), body=_body(), headers={}
    )

    assert result.status_code == 400
    chunks = await _drain(result.body)
    assert json.loads(chunks[0]) == {"error": {"message": "bad request"}}


@pytest.mark.asyncio
async def test_non_streaming_result_yields_single_chunk_and_usage():
    payload = {
        "id": "x",
        "choices": [],
        "usage": {"prompt_tokens": 3, "completion_tokens": 5},
    }

    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json=payload)

    adapter = _adapter(handler)
    result = await adapter.relay_chat_completion(
        route=_route(),
        secret=None,
        context=_context(stream=False),
        body=_body(),
        headers={},
    )

    chunks = await _drain(result.body)
    assert len(chunks) == 1
    assert json.loads(chunks[0]) == payload
    assert result.usage.input_tokens == 3
    assert result.usage.output_tokens == 5


@pytest.mark.asyncio
async def test_streaming_result_passes_sse_chunks_through_unmodified():
    sse = b'data: {"choices":[]}\n\n' + b"data: [DONE]\n\n"

    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(
            200, content=sse, headers={"content-type": "text/event-stream"}
        )

    adapter = _adapter(handler)
    result = await adapter.relay_chat_completion(
        route=_route(),
        secret=None,
        context=_context(stream=True),
        body=_body(),
        headers={},
    )

    chunks = await _drain(result.body)
    assert b"".join(chunks) == sse
    assert result.usage is None


@pytest.mark.asyncio
async def test_missing_base_url_raises_llm_upstream_error():
    adapter = RelayLLMAdapter()

    with pytest.raises(LLMUpstreamError):
        await adapter.relay_chat_completion(
            route=_route(base_url=None),
            secret=None,
            context=_context(),
            body=_body(),
            headers={},
        )


@pytest.mark.asyncio
async def test_configured_timeout_overrides_default():
    captured = {}

    def handler(request: httpx.Request) -> httpx.Response:
        captured["request"] = request
        return httpx.Response(200, json={"id": "x", "choices": []})

    adapter = _adapter(handler)
    await adapter.relay_chat_completion(
        route=_route(timeout_seconds=5.0),
        secret=None,
        context=_context(),
        body=_body(),
        headers={},
    )

    assert captured["request"].extensions["timeout"]["connect"] == 5.0


@pytest.mark.asyncio
async def test_bedrock_messages_request_composes_mantle_url_and_leaves_body_untouched():
    """OD19: Bedrock's Messages door moved to bedrock-mantle, which needs no rewrite —
    the negative space of the Vertex pairing test below. Both assertions (URL, byte-for-
    byte body including `model`) live in one test so the two halves cannot drift apart."""
    captured = {}

    def handler(request: httpx.Request) -> httpx.Response:
        captured["content"] = request.content
        captured["url"] = _routed_url(request)
        return httpx.Response(200, json={"id": "x", "content": []})

    adapter = _adapter(handler)
    route = LLMResolvedRoute(
        provider_key=None,
        deployment_kind=LLMDeploymentKind.BEDROCK,
        model="anthropic.claude-3-5-sonnet",
        base_url="https://bedrock.example",
    )
    context = LLMCallContext(
        model="anthropic.claude-3-5-sonnet", stream=False, protocol=LLMProtocol.MESSAGES
    )
    body = json.dumps(
        {
            "model": "anthropic.claude-3-5-sonnet",
            "max_tokens": 1024,
            "messages": [{"role": "user", "content": "hi"}],
        }
    ).encode()

    await adapter.relay_chat_completion(
        route=route,
        secret=_custom_secret(extras={"aws_bearer_token_bedrock": "bedrock-token"}),
        context=context,
        body=body,
        headers={},
    )

    assert captured["url"] == "https://bedrock.example/anthropic/v1/messages"
    assert captured["content"] == body


@pytest.mark.asyncio
async def test_bedrock_messages_request_forwards_the_anthropic_version_header():
    """A native Anthropic client sends this header on every Messages call, and mantle
    wants exactly it — the relay must not strip it (D34: only the caller's own headers
    reach the upstream, nothing invented)."""
    captured = {}

    def handler(request: httpx.Request) -> httpx.Response:
        captured["headers"] = request.headers
        return httpx.Response(200, json={"id": "x", "content": []})

    adapter = _adapter(handler)
    route = LLMResolvedRoute(
        provider_key=None,
        deployment_kind=LLMDeploymentKind.BEDROCK,
        model="anthropic.claude-3-5-sonnet",
        base_url="https://bedrock.example",
    )
    context = LLMCallContext(
        model="anthropic.claude-3-5-sonnet", stream=False, protocol=LLMProtocol.MESSAGES
    )

    await adapter.relay_chat_completion(
        route=route,
        secret=_custom_secret(extras={"aws_bearer_token_bedrock": "bedrock-token"}),
        context=context,
        body=_body(),
        headers={"anthropic-version": "2023-06-01"},
    )

    assert captured["headers"]["anthropic-version"] == "2023-06-01"
    assert captured["headers"]["authorization"] == "Bearer bedrock-token"


@pytest.mark.asyncio
async def test_vertex_messages_request_moves_model_from_body_to_url():
    captured = {}

    def handler(request: httpx.Request) -> httpx.Response:
        captured["content"] = request.content
        captured["url"] = _routed_url(request)
        return httpx.Response(200, json={"id": "x", "content": []})

    adapter = _adapter(handler)
    route = LLMResolvedRoute(
        provider_key=None,
        deployment_kind=LLMDeploymentKind.VERTEX,
        model="claude-3-5-sonnet",
        base_url="https://vertex.example/v1/projects/acme/locations/europe-west4",
        extras={"vertex_project": "acme"},
    )
    context = LLMCallContext(
        model="claude-3-5-sonnet", stream=False, protocol=LLMProtocol.MESSAGES
    )
    body = json.dumps(
        {
            "model": "claude-3-5-sonnet",
            "max_tokens": 1024,
            "messages": [{"role": "user", "content": "hi"}],
        }
    ).encode()

    with patch(
        "litellm.llms.vertex_ai.vertex_llm_base.VertexBase.get_access_token_async",
        new_callable=AsyncMock,
        return_value=("minted-token", "acme"),
    ):
        await adapter.relay_chat_completion(
            route=route,
            secret=_custom_secret(
                extras={"vertex_ai_credentials": '{"type": "service_account"}'}
            ),
            context=context,
            body=body,
            headers={},
        )

    assert captured["url"] == (
        "https://vertex.example/v1/projects/acme/locations/europe-west4/"
        "publishers/anthropic/models/claude-3-5-sonnet:rawPredict"
    )
    sent = json.loads(captured["content"])
    assert sent["anthropic_version"] == "vertex-2023-10-16"
    assert "model" not in sent
    assert captured["content"] != body


@pytest.mark.asyncio
async def test_vertex_streaming_messages_request_uses_the_stream_action():
    captured = {}

    def handler(request: httpx.Request) -> httpx.Response:
        captured["url"] = _routed_url(request)
        return httpx.Response(200, json={"id": "x", "content": []})

    adapter = _adapter(handler)
    route = LLMResolvedRoute(
        provider_key=None,
        deployment_kind=LLMDeploymentKind.VERTEX,
        model="claude-3-5-sonnet",
        base_url="https://vertex.example/v1/projects/acme/locations/europe-west4",
        extras={"vertex_project": "acme"},
    )
    context = LLMCallContext(
        model="claude-3-5-sonnet", stream=True, protocol=LLMProtocol.MESSAGES
    )
    body = json.dumps(
        {
            "model": "claude-3-5-sonnet",
            "max_tokens": 1024,
            "messages": [{"role": "user", "content": "hi"}],
        }
    ).encode()

    with patch(
        "litellm.llms.vertex_ai.vertex_llm_base.VertexBase.get_access_token_async",
        new_callable=AsyncMock,
        return_value=("minted-token", "acme"),
    ):
        await adapter.relay_chat_completion(
            route=route,
            secret=_custom_secret(
                extras={"vertex_ai_credentials": '{"type": "service_account"}'}
            ),
            context=context,
            body=body,
            headers={},
        )

    assert captured["url"] == (
        "https://vertex.example/v1/projects/acme/locations/europe-west4/"
        "publishers/anthropic/models/claude-3-5-sonnet:streamRawPredict"
    )


@pytest.mark.asyncio
async def test_every_deployment_kind_other_than_vertex_stays_byte_for_byte_on_messages():
    """Names the exemption (specs-wp27.md, OD19) rather than weakening this file's other
    byte-for-byte assertions: every non-Vertex kind, Bedrock included, is untouched even on
    the Messages door where the rewrite is gated to apply."""
    captured = {}

    def handler(request: httpx.Request) -> httpx.Response:
        captured["content"] = request.content
        return httpx.Response(200, json={"id": "x", "content": []})

    adapter = _adapter(handler)
    route = _route()  # CUSTOM
    context = LLMCallContext(
        model="gpt-4o", stream=False, protocol=LLMProtocol.MESSAGES
    )
    body = _body()

    await adapter.relay_chat_completion(
        route=route, secret=None, context=context, body=body, headers={}
    )

    assert captured["content"] == body


@pytest.mark.asyncio
async def test_default_timeout_used_when_route_leaves_it_unset():
    captured = {}

    def handler(request: httpx.Request) -> httpx.Response:
        captured["request"] = request
        return httpx.Response(200, json={"id": "x", "choices": []})

    adapter = _adapter(handler)
    await adapter.relay_chat_completion(
        route=_route(timeout_seconds=None),
        secret=None,
        context=_context(),
        body=_body(),
        headers={},
    )

    assert captured["request"].extensions["timeout"]["connect"] == 60.0


# --- OR49: usage on the streaming path ------------------------------------------ #


_CHAT_USAGE_FRAME = (
    b'data: {"id":"chatcmpl-1","choices":[],'
    b'"usage":{"prompt_tokens":11,"completion_tokens":7}}\n\n'
)
_CHAT_CONTENT_FRAME = (
    b'data: {"id":"chatcmpl-1","choices":[{"delta":{"content":"hi"}}]}\n\n'
)
_DONE_FRAME = b"data: [DONE]\n\n"


def _sse_handler(payload: bytes):
    def handler(request: httpx.Request) -> httpx.Response:
        handler.request = request  # type: ignore[attr-defined]
        return httpx.Response(
            200, content=payload, headers={"content-type": "text/event-stream"}
        )

    return handler


@pytest.mark.asyncio
async def test_a_streaming_chat_request_is_relayed_exactly_as_the_caller_sent_it():
    """The gateway does not add `stream_options.include_usage` to a body that lacks it.

    Asking for usage the caller did not ask for would buy a metering number at the cost of
    the byte-for-byte relay this door promises (D34), a re-framed response, and a refusal
    from any upstream that rejects unknown fields. The call is relayed untouched instead,
    and a Chat Completions stream that reports no usage is recorded as reporting none.
    """
    handler = _sse_handler(_CHAT_CONTENT_FRAME + _DONE_FRAME)
    adapter = _adapter(handler)
    sent = json.dumps(
        {
            "model": "gpt-4o",
            "messages": [{"role": "user", "content": "hi"}],
            "stream": True,
        }
    ).encode()

    result = await adapter.relay_chat_completion(
        route=_route(),
        secret=None,
        context=_context(stream=True),
        body=sent,
        headers={},
    )
    relayed = b"".join(await _drain(result.body))

    assert handler.request.content == sent
    assert b"stream_options" not in handler.request.content
    assert relayed == _CHAT_CONTENT_FRAME + _DONE_FRAME
    assert result.usage is None, "no usage was reported, which is not usage of zero"


@pytest.mark.asyncio
async def test_a_caller_that_asked_for_stream_usage_is_metered_from_the_frame_it_asked_for():
    """Its body travels unchanged, it keeps the frame, and the call meters from that frame."""
    handler = _sse_handler(_CHAT_CONTENT_FRAME + _CHAT_USAGE_FRAME + _DONE_FRAME)
    adapter = _adapter(handler)
    asked = json.dumps(
        {
            "model": "gpt-4o",
            "messages": [{"role": "user", "content": "hi"}],
            "stream": True,
            "stream_options": {"include_usage": True},
        }
    ).encode()

    result = await adapter.relay_chat_completion(
        route=_route(),
        secret=None,
        context=_context(stream=True),
        body=asked,
        headers={},
    )
    relayed = b"".join(await _drain(result.body))

    assert handler.request.content == asked
    assert relayed == _CHAT_CONTENT_FRAME + _CHAT_USAGE_FRAME + _DONE_FRAME
    assert result.usage.input_tokens == 11
    assert result.usage.output_tokens == 7


@pytest.mark.asyncio
async def test_a_non_streaming_chat_request_is_relayed_exactly_as_the_caller_sent_it():
    handler = _sse_handler(b'{"id":"x","choices":[]}')
    adapter = _adapter(handler)

    await adapter.relay_chat_completion(
        route=_route(),
        secret=None,
        context=_context(stream=False),
        body=_body(),
        headers={},
    )

    assert handler.request.content == _body()


@pytest.mark.asyncio
async def test_a_streamed_messages_call_adds_up_its_head_and_tail_usage():
    """Anthropic reports input tokens in `message_start`, the FIRST frame, and output
    tokens near the end. A tail scan saw only half of that (OR49)."""
    head = (
        b'event: message_start\ndata: {"type":"message_start","message":'
        b'{"id":"msg-1","usage":{"input_tokens":11,"output_tokens":0}}}\n\n'
    )
    filler = (
        b'event: content_block_delta\ndata: {"type":"content_block_delta",'
        b'"delta":{"text":"' + b"x" * 9000 + b'"}}\n\n'
    )
    tail = (
        b'event: message_delta\ndata: {"type":"message_delta",'
        b'"usage":{"output_tokens":7}}\n\n'
        b'event: message_stop\ndata: {"type":"message_stop"}\n\n'
    )
    handler = _sse_handler(head + filler + tail)
    adapter = _adapter(handler)
    context = LLMCallContext(model="gpt-4o", stream=True, protocol=LLMProtocol.MESSAGES)

    result = await adapter.relay_chat_completion(
        route=_route(),
        secret=None,
        context=context,
        body=json.dumps(
            {"model": "gpt-4o", "max_tokens": 16, "messages": [], "stream": True}
        ).encode(),
        headers={},
    )
    relayed = b"".join(await _drain(result.body))

    assert relayed == head + filler + tail, "a Messages stream is relayed untouched"
    assert result.usage.input_tokens == 11
    assert result.usage.output_tokens == 7


@pytest.mark.asyncio
async def test_a_streamed_responses_call_reads_a_terminal_event_larger_than_any_tail():
    """A `response.completed` event carries the whole response object, so the usage can sit
    further from the end of the stream than a tail buffer reaches (OR49)."""
    completed = {
        "type": "response.completed",
        "response": {
            "id": "resp-1",
            "output": [{"type": "output_text", "text": "x" * 9000}],
            "usage": {"input_tokens": 11, "output_tokens": 7},
        },
    }
    payload = (
        b'event: response.created\ndata: {"type":"response.created"}\n\n'
        + f"event: response.completed\ndata: {json.dumps(completed)}\n\n".encode()
    )
    handler = _sse_handler(payload)
    adapter = _adapter(handler)
    context = LLMCallContext(
        model="gpt-4o", stream=True, protocol=LLMProtocol.RESPONSES
    )

    result = await adapter.relay_chat_completion(
        route=_route(),
        secret=None,
        context=context,
        body=json.dumps({"model": "gpt-4o", "input": "hi", "stream": True}).encode(),
        headers={},
    )
    relayed = b"".join(await _drain(result.body))

    assert relayed == payload, "a Responses stream is relayed untouched"
    assert result.usage.input_tokens == 11
    assert result.usage.output_tokens == 7
