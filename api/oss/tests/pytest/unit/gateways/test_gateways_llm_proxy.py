"""Unit tests for LLMGatewayProxy (entities.md §9, workstreams/specs-wp6.md).

Nothing running: the proxy is exercised against a hand-written mock `LLMGatewayService`
(not WP5's fixture — this is the proxy in isolation) and a Starlette `Request` built from a
raw ASGI scope, no HTTP server.
"""

import json
from contextlib import contextmanager
from typing import Any, AsyncIterator, Dict, List, Optional
from uuid import uuid4

import pytest
from starlette.requests import Request

from oss.src.apis.fastapi.gateways.llms.proxy import LLMGatewayProxy
from oss.src.core.gateways.dtos import GatewayEndpointNamespace
from oss.src.core.gateways.llms.dtos import LLMProtocol
from oss.src.core.gateways.llms.interfaces import LLMRelayResult
from oss.src.core.gateways.llms.types import (
    LLMEndpointNotFoundError,
    LLMModelNotAllowedError,
    LLMUpstreamError,
)
from oss.src.core.access.permissions.types import Permission
from oss.src.core.gateways.policy.dtos import SecretMode, SecretOwnerKind
from oss.src.core.gateways.policy.types import (
    CeilingExceededError,
    SecretInvalidError,
    SecretNotFoundError,
    EntitlementDeniedError,
    PolicyDeniedError,
)
from oss.src.utils.context import (
    AuthContext,
    AuthScope,
    SecretCredentials,
    reset_auth_context,
    set_auth_context,
)


@contextmanager
def _auth_scope():
    scope = AuthScope(
        organization_id=uuid4(),
        workspace_id=uuid4(),
        project_id=uuid4(),
        user_id=uuid4(),
    )
    token = set_auth_context(
        AuthContext(credentials=SecretCredentials(value="test-token"), scope=scope)
    )
    try:
        yield scope
    finally:
        reset_auth_context(token)


def _request(*, body: bytes, headers: Optional[Dict[str, str]] = None) -> Request:
    headers = headers or {}
    raw_headers = [(k.lower().encode(), v.encode()) for k, v in headers.items()]
    scope = {"type": "http", "method": "POST", "path": "/", "headers": raw_headers}

    async def receive() -> Dict[str, Any]:
        return {"type": "http.request", "body": body, "more_body": False}

    return Request(scope, receive)


def _body(*, model: str = "gpt-4o", stream: bool = False) -> bytes:
    return json.dumps({"model": model, "stream": stream, "messages": []}).encode()


def _responses_body(*, model: str = "gpt-4o", stream: bool = False) -> bytes:
    return json.dumps({"model": model, "stream": stream, "input": []}).encode()


def _messages_body(*, model: str = "claude-3", stream: bool = False) -> bytes:
    return json.dumps(
        {"model": model, "stream": stream, "messages": [], "max_tokens": 1024}
    ).encode()


async def _chunks(*items: bytes) -> AsyncIterator[bytes]:
    for item in items:
        yield item


def _relay_result(
    *,
    status_code: int = 200,
    chunks: List[bytes],
    headers: Optional[Dict[str, str]] = None,
) -> LLMRelayResult:
    return LLMRelayResult(
        status_code=status_code, headers=headers or {}, body=_chunks(*chunks)
    )


class _MockLlmGatewayService:
    def __init__(
        self,
        *,
        relay_result: Optional[LLMRelayResult] = None,
        relay_exception: Optional[Exception] = None,
        models: Optional[List[str]] = None,
        models_exception: Optional[Exception] = None,
    ) -> None:
        self._relay_result = relay_result
        self._relay_exception = relay_exception
        self._models = models or []
        self._models_exception = models_exception
        self.relay_calls: List[Dict[str, Any]] = []
        self.list_models_calls: List[Dict[str, Any]] = []

    async def relay_chat_completion(
        self, *, scope, namespace, name, body, headers, protocol=None
    ) -> LLMRelayResult:
        self.relay_calls.append(
            {
                "scope": scope,
                "namespace": namespace,
                "name": name,
                "body": body,
                "headers": headers,
                "protocol": protocol,
            }
        )
        if self._relay_exception is not None:
            raise self._relay_exception
        assert self._relay_result is not None
        return self._relay_result

    async def list_models(self, *, scope, namespace, name) -> List[str]:
        self.list_models_calls.append(
            {"scope": scope, "namespace": namespace, "name": name}
        )
        if self._models_exception is not None:
            raise self._models_exception
        return self._models


async def _read_body(response) -> bytes:
    if hasattr(response, "body_iterator"):
        return b"".join([chunk async for chunk in response.body_iterator])
    return response.body


# --- successful relay --------------------------------------------------------- #


@pytest.mark.asyncio
async def test_non_streaming_call_returns_single_chunk_verbatim():
    chunk = json.dumps({"id": "x", "choices": []}).encode()
    service = _MockLlmGatewayService(
        relay_result=_relay_result(status_code=200, chunks=[chunk])
    )
    proxy = LLMGatewayProxy(llm_gateway_service=service)

    with _auth_scope():
        response = await proxy.chat_completions_custom(
            _request(body=_body(stream=False)), "my-slug"
        )

    assert response.status_code == 200
    assert await _read_body(response) == chunk


@pytest.mark.asyncio
async def test_streaming_call_passes_body_through_streaming_response_untouched():
    frames = [b"data: one\n\n", b"data: two\n\n", b"data: [DONE]\n\n"]
    service = _MockLlmGatewayService(
        relay_result=_relay_result(status_code=200, chunks=frames)
    )
    proxy = LLMGatewayProxy(llm_gateway_service=service)

    with _auth_scope():
        response = await proxy.chat_completions_custom(
            _request(body=_body(stream=True)), "my-slug"
        )

    assert response.media_type == "text/event-stream"
    assert await _read_body(response) == b"".join(frames)


@pytest.mark.asyncio
async def test_standard_route_passes_standard_namespace_and_provider_as_name():
    service = _MockLlmGatewayService(
        relay_result=_relay_result(status_code=200, chunks=[b"{}"])
    )
    proxy = LLMGatewayProxy(llm_gateway_service=service)

    with _auth_scope():
        await proxy.chat_completions_standard(_request(body=_body()), "openai")

    assert service.relay_calls[0]["namespace"] == GatewayEndpointNamespace.STANDARD
    assert service.relay_calls[0]["name"] == "openai"


@pytest.mark.asyncio
async def test_custom_route_passes_custom_namespace_and_slug_as_name():
    service = _MockLlmGatewayService(
        relay_result=_relay_result(status_code=200, chunks=[b"{}"])
    )
    proxy = LLMGatewayProxy(llm_gateway_service=service)

    with _auth_scope():
        await proxy.chat_completions_custom(_request(body=_body()), "my-slug")

    assert service.relay_calls[0]["namespace"] == GatewayEndpointNamespace.CUSTOM
    assert service.relay_calls[0]["name"] == "my-slug"


@pytest.mark.asyncio
async def test_gateway_credential_is_stripped_but_upstream_authorization_is_preserved():
    service = _MockLlmGatewayService(
        relay_result=_relay_result(status_code=200, chunks=[b"{}"])
    )
    proxy = LLMGatewayProxy(llm_gateway_service=service)

    with _auth_scope():
        await proxy.chat_completions_custom(
            _request(
                body=_body(),
                headers={
                    "Authorization": "Bearer upstream-token",
                    "X-AG-Credentials": "ApiKey gateway-token",
                },
            ),
            "my-slug",
        )

    headers = service.relay_calls[0]["headers"]
    normalized = {key.lower(): value for key, value in headers.items()}
    assert normalized["authorization"] == "Bearer upstream-token"
    assert "x-ag-credentials" not in normalized


@pytest.mark.asyncio
async def test_response_headers_drop_upstreams_stale_content_length():
    result = _relay_result(
        status_code=200,
        chunks=[b"hello world"],
        headers={"content-length": "999999", "x-upstream": "yes"},
    )
    service = _MockLlmGatewayService(relay_result=result)
    proxy = LLMGatewayProxy(llm_gateway_service=service)

    with _auth_scope():
        response = await proxy.chat_completions_custom(
            _request(body=_body(stream=False)), "my-slug"
        )

    assert response.headers["content-length"] == str(len(b"hello world"))
    assert response.headers["x-upstream"] == "yes"


# --- routing / validation failures before the service is ever called --------- #


@pytest.mark.asyncio
async def test_missing_model_returns_openai_invalid_request_error_without_calling_service():
    service = _MockLlmGatewayService()
    proxy = LLMGatewayProxy(llm_gateway_service=service)
    body = json.dumps({"messages": []}).encode()

    with _auth_scope():
        response = await proxy.chat_completions_custom(_request(body=body), "my-slug")

    assert response.status_code == 400
    payload = json.loads(response.body)
    assert payload["error"]["code"] == "invalid_request"
    assert service.relay_calls == []


# --- OpenAI-shaped denial mapping, one case per documented exception --------- #


_DENIAL_CASES = [
    (
        PolicyDeniedError(permission=Permission.USE_LLM_ENDPOINTS, target="t"),
        403,
        "policy_denied",
    ),
    (EntitlementDeniedError(key="k", target="t"), 403, "policy_denied"),
    (
        LLMModelNotAllowedError(
            model="gpt-4o", namespace=GatewayEndpointNamespace.CUSTOM, name="my-slug"
        ),
        403,
        "model_not_allowed",
    ),
    (
        CeilingExceededError(
            ceiling="max_output_tokens", requested=1000, allowed=100, target="t"
        ),
        400,
        "ceiling_exceeded",
    ),
    (
        SecretNotFoundError(
            mode=SecretMode.PROJECT_ONLY,
            missing=SecretOwnerKind.PROJECT,
            target="t",
        ),
        409,
        "secret_missing",
    ),
    (
        SecretInvalidError(target="t", detail="revoked"),
        409,
        "secret_invalid",
    ),
    (
        LLMEndpointNotFoundError(
            namespace=GatewayEndpointNamespace.CUSTOM, name="my-slug"
        ),
        404,
        "endpoint_not_found",
    ),
    (
        LLMUpstreamError(provider_key="openai", status_code=503, detail="down"),
        502,
        "upstream_error",
    ),
    (
        LLMUpstreamError(provider_key="openai", status_code=400, detail="bad"),
        424,
        "upstream_error",
    ),
    (
        LLMUpstreamError(provider_key="openai", status_code=None, detail="timed out"),
        424,
        "upstream_error",
    ),
]


@pytest.mark.asyncio
@pytest.mark.parametrize("exc,expected_status,expected_code", _DENIAL_CASES)
async def test_domain_exception_maps_to_openai_shaped_denial(
    exc, expected_status, expected_code
):
    service = _MockLlmGatewayService(relay_exception=exc)
    proxy = LLMGatewayProxy(llm_gateway_service=service)

    with _auth_scope():
        response = await proxy.chat_completions_custom(
            _request(body=_body()), "my-slug"
        )

    assert response.status_code == expected_status
    payload = json.loads(response.body)
    assert set(payload.keys()) == {"error"}
    assert payload["error"]["code"] == expected_code
    assert "count" not in payload  # the house envelope never leaks onto this surface


@pytest.mark.asyncio
async def test_upstream_exception_detail_is_not_exposed_to_the_caller():
    service = _MockLlmGatewayService(
        relay_exception=LLMUpstreamError(
            provider_key="openai",
            status_code=503,
            detail="traceback: provider internals",
        )
    )
    proxy = LLMGatewayProxy(llm_gateway_service=service)

    with _auth_scope():
        response = await proxy.chat_completions_custom(
            _request(body=_body()), "my-slug"
        )

    assert response.status_code == 502
    assert json.loads(response.body)["error"]["message"] == "upstream request failed"


@pytest.mark.asyncio
@pytest.mark.parametrize("exc,expected_status,expected_code", _DENIAL_CASES)
async def test_typed_denials_carry_the_code_marker_in_message_except_upstream_error(
    exc, expected_status, expected_code
):
    """WP25/OD18: `code` must survive in `message` alone, because Codex's own SDK
    (codex-rs's `extract_error_message`) discards every other field. `upstream_error`
    is excluded — D16 forwards the upstream's own detail untouched."""
    service = _MockLlmGatewayService(relay_exception=exc)
    proxy = LLMGatewayProxy(llm_gateway_service=service)

    with _auth_scope():
        response = await proxy.chat_completions_custom(
            _request(body=_body()), "my-slug"
        )

    message = json.loads(response.body)["error"]["message"]
    marker = f"⟦agenta_code:{expected_code}⟧"
    if expected_code == "upstream_error":
        assert marker not in message
    else:
        assert message.endswith(marker)


@pytest.mark.asyncio
async def test_ceiling_exceeded_names_the_three_values():
    exc = CeilingExceededError(
        ceiling="max_output_tokens", requested=1000, allowed=100, target="t"
    )
    service = _MockLlmGatewayService(relay_exception=exc)
    proxy = LLMGatewayProxy(llm_gateway_service=service)

    with _auth_scope():
        response = await proxy.chat_completions_custom(
            _request(body=_body()), "my-slug"
        )

    error = json.loads(response.body)["error"]
    assert error["ceiling"] == "max_output_tokens"
    assert error["requested"] == 1000
    assert error["allowed"] == 100


# --- list_models --------------------------------------------------------------- #


@pytest.mark.asyncio
async def test_list_models_standard_shapes_the_openai_list_body():
    service = _MockLlmGatewayService(models=["gpt-4o", "gpt-4o-mini"])
    proxy = LLMGatewayProxy(llm_gateway_service=service)

    with _auth_scope():
        result = await proxy.list_models_standard("openai")

    assert result == {
        "object": "list",
        "data": [
            {"id": "gpt-4o", "object": "model"},
            {"id": "gpt-4o-mini", "object": "model"},
        ],
    }
    assert (
        service.list_models_calls[0]["namespace"] == GatewayEndpointNamespace.STANDARD
    )
    assert service.list_models_calls[0]["name"] == "openai"


@pytest.mark.asyncio
async def test_list_models_custom_shapes_the_openai_list_body():
    service = _MockLlmGatewayService(models=["mock/echo"])
    proxy = LLMGatewayProxy(llm_gateway_service=service)

    with _auth_scope():
        result = await proxy.list_models_custom("my-slug")

    assert result == {
        "object": "list",
        "data": [{"id": "mock/echo", "object": "model"}],
    }
    assert service.list_models_calls[0]["namespace"] == GatewayEndpointNamespace.CUSTOM
    assert service.list_models_calls[0]["name"] == "my-slug"


@pytest.mark.asyncio
async def test_list_models_maps_domain_exception_too():
    exc = LLMEndpointNotFoundError(
        namespace=GatewayEndpointNamespace.CUSTOM, name="missing-slug"
    )
    service = _MockLlmGatewayService(models_exception=exc)
    proxy = LLMGatewayProxy(llm_gateway_service=service)

    with _auth_scope():
        response = await proxy.list_models_custom("missing-slug")

    assert response.status_code == 404
    assert json.loads(response.body)["error"]["code"] == "endpoint_not_found"


# --- the responses and messages doors (D33, WP23) ------------------------------ #
#
# Same behavior as chat_completions above, exercised per door: the route reaches the
# handler, the context carries the right model/stream/protocol, and the body passes
# through untouched. Nothing below the handler branches on protocol, so one
# parametrized set covers all three doors without three copies of the same assertions.

_DOORS = [
    (
        "chat_completions_standard",
        "chat_completions_custom",
        _body,
        LLMProtocol.CHAT_COMPLETIONS,
    ),
    (
        "responses_standard",
        "responses_custom",
        _responses_body,
        LLMProtocol.RESPONSES,
    ),
    (
        "messages_standard",
        "messages_custom",
        _messages_body,
        LLMProtocol.MESSAGES,
    ),
]


@pytest.mark.asyncio
@pytest.mark.parametrize("standard_handler,custom_handler,body_fn,protocol", _DOORS)
async def test_door_standard_route_passes_namespace_provider_and_protocol(
    standard_handler, custom_handler, body_fn, protocol
):
    service = _MockLlmGatewayService(
        relay_result=_relay_result(status_code=200, chunks=[b"{}"])
    )
    proxy = LLMGatewayProxy(llm_gateway_service=service)
    handler = getattr(proxy, standard_handler)

    with _auth_scope():
        await handler(_request(body=body_fn()), "openai")

    call = service.relay_calls[0]
    assert call["namespace"] == GatewayEndpointNamespace.STANDARD
    assert call["name"] == "openai"
    assert call["protocol"] == protocol


@pytest.mark.asyncio
@pytest.mark.parametrize("standard_handler,custom_handler,body_fn,protocol", _DOORS)
async def test_door_custom_route_passes_namespace_slug_and_protocol(
    standard_handler, custom_handler, body_fn, protocol
):
    service = _MockLlmGatewayService(
        relay_result=_relay_result(status_code=200, chunks=[b"{}"])
    )
    proxy = LLMGatewayProxy(llm_gateway_service=service)
    handler = getattr(proxy, custom_handler)

    with _auth_scope():
        await handler(_request(body=body_fn()), "my-slug")

    call = service.relay_calls[0]
    assert call["namespace"] == GatewayEndpointNamespace.CUSTOM
    assert call["name"] == "my-slug"
    assert call["protocol"] == protocol


@pytest.mark.asyncio
@pytest.mark.parametrize("standard_handler,custom_handler,body_fn,protocol", _DOORS)
async def test_door_body_relays_byte_for_byte(
    standard_handler, custom_handler, body_fn, protocol
):
    raw_body = body_fn(stream=False)
    service = _MockLlmGatewayService(
        relay_result=_relay_result(status_code=200, chunks=[b"{}"])
    )
    proxy = LLMGatewayProxy(llm_gateway_service=service)
    handler = getattr(proxy, custom_handler)

    with _auth_scope():
        await handler(_request(body=raw_body), "my-slug")

    assert service.relay_calls[0]["body"] == raw_body


@pytest.mark.asyncio
@pytest.mark.parametrize("standard_handler,custom_handler,body_fn,protocol", _DOORS)
async def test_door_streaming_flag_drives_the_response_shape(
    standard_handler, custom_handler, body_fn, protocol
):
    frames = [b"data: one\n\n", b"data: [DONE]\n\n"]
    service = _MockLlmGatewayService(
        relay_result=_relay_result(status_code=200, chunks=frames)
    )
    proxy = LLMGatewayProxy(llm_gateway_service=service)
    handler = getattr(proxy, custom_handler)

    with _auth_scope():
        response = await handler(_request(body=body_fn(stream=True)), "my-slug")

    assert response.media_type == "text/event-stream"
    assert await _read_body(response) == b"".join(frames)


@pytest.mark.asyncio
@pytest.mark.parametrize("standard_handler,custom_handler,body_fn,protocol", _DOORS)
async def test_door_missing_model_returns_invalid_request_without_calling_service(
    standard_handler, custom_handler, body_fn, protocol
):
    service = _MockLlmGatewayService()
    proxy = LLMGatewayProxy(llm_gateway_service=service)
    handler = getattr(proxy, custom_handler)
    body = json.dumps({"stream": False}).encode()

    with _auth_scope():
        response = await handler(_request(body=body), "my-slug")

    assert response.status_code == 400
    assert json.loads(response.body)["error"]["code"] == "invalid_request"
    assert service.relay_calls == []


# --- the route table (a door added without a test is a door nobody knows about) --- #


def test_route_table_matches_the_design_exactly():
    proxy = LLMGatewayProxy(llm_gateway_service=_MockLlmGatewayService())

    actual = {}
    for route in proxy.router.routes:
        for method in route.methods:
            if method == "HEAD":
                continue
            actual[(route.path, method)] = route.operation_id

    assert actual == {
        (
            "/builtin/{provider}/v1/chat/completions",
            "POST",
        ): "llm_gateway_chat_completions_builtin",
        (
            "/standard/{provider}/v1/chat/completions",
            "POST",
        ): "llm_gateway_chat_completions_standard",
        (
            "/custom/{slug}/v1/chat/completions",
            "POST",
        ): "llm_gateway_chat_completions_custom",
        ("/builtin/{provider}/v1/responses", "POST"): "llm_gateway_responses_builtin",
        ("/standard/{provider}/v1/responses", "POST"): "llm_gateway_responses_standard",
        ("/custom/{slug}/v1/responses", "POST"): "llm_gateway_responses_custom",
        ("/builtin/{provider}/v1/messages", "POST"): "llm_gateway_messages_builtin",
        ("/standard/{provider}/v1/messages", "POST"): "llm_gateway_messages_standard",
        ("/custom/{slug}/v1/messages", "POST"): "llm_gateway_messages_custom",
        ("/builtin/{provider}/v1/models", "GET"): "llm_gateway_list_models_builtin",
        ("/standard/{provider}/v1/models", "GET"): "llm_gateway_list_models_standard",
        ("/custom/{slug}/v1/models", "GET"): "llm_gateway_list_models_custom",
    }
