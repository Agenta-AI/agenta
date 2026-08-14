"""Unit tests for RelayLLMAdapter (entities.md §7.1, workstreams/specs-wp24.md).

Nothing running: httpx.MockTransport intercepts every request, no real socket.
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
async def test_custom_provider_secret_injects_bearer_and_merges_extras():
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
    assert request.headers["x-org-id"] == "org-1"


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
async def test_caller_authorization_reaches_the_upstream_when_no_secret_resolved():
    """Pass-through (OD15): the data plane reads only our own header, so `Authorization`
    is the caller's own vendor auth and nothing overwrites it."""
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
        headers={"Authorization": "Bearer caller-subscription"},
    )

    assert captured["request"].headers["authorization"] == "Bearer caller-subscription"


@pytest.mark.asyncio
async def test_a_resolved_secret_overwrites_the_callers_authorization():
    """The other half of the same rule: when we do hold a secret, ours is what goes out."""
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
        headers={"Authorization": "Bearer caller-subscription"},
    )

    assert captured["request"].headers["authorization"] == "Bearer sk-ours"


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

    assert (
        str(captured["request"].url) == "https://upstream.example/v1/chat/completions"
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
async def test_bedrock_messages_request_gets_the_static_field_rewrite():
    """D40: the exemption to byte-for-byte. `model` leaves the body, `anthropic_version`
    (the Bedrock constant) joins it — verified on the wire the adapter actually sends."""
    captured = {}

    def handler(request: httpx.Request) -> httpx.Response:
        captured["content"] = request.content
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

    sent = json.loads(captured["content"])
    assert sent["anthropic_version"] == "bedrock-2023-05-31"
    assert "model" not in sent
    assert captured["content"] != body


@pytest.mark.asyncio
async def test_vertex_messages_request_gets_the_static_field_rewrite():
    captured = {}

    def handler(request: httpx.Request) -> httpx.Response:
        captured["content"] = request.content
        return httpx.Response(200, json={"id": "x", "content": []})

    adapter = _adapter(handler)
    route = LLMResolvedRoute(
        provider_key=None,
        deployment_kind=LLMDeploymentKind.VERTEX,
        model="claude-3-5-sonnet",
        base_url="https://vertex.example",
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

    sent = json.loads(captured["content"])
    assert sent["anthropic_version"] == "vertex-2023-10-16"
    assert "model" not in sent
    assert captured["content"] != body


@pytest.mark.asyncio
async def test_every_deployment_kind_other_than_bedrock_vertex_stays_byte_for_byte_on_messages():
    """Names the exemption (specs-wp27.md) rather than weakening this file's other
    byte-for-byte assertions: every non-Bedrock/Vertex kind is untouched, even on the
    Messages door where the rewrite is gated to apply."""
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
