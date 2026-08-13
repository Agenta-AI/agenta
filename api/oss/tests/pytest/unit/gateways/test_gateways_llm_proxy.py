"""Unit tests for LlmGatewayProxy (entities.md §9, workstreams/specs-wp6.md).

Nothing running: the proxy is exercised against a hand-written mock `LlmGatewayService`
(not WP5's fixture — this is the proxy in isolation) and a Starlette `Request` built from a
raw ASGI scope, no HTTP server.
"""

import json
from contextlib import contextmanager
from typing import Any, AsyncIterator, Dict, List, Optional
from uuid import uuid4

import pytest
from starlette.requests import Request

from oss.src.apis.fastapi.gateways.llms.proxy import LlmGatewayProxy
from oss.src.core.gateways.dtos import GatewayEndpointNamespace
from oss.src.core.gateways.llms.interfaces import LlmRelayResult
from oss.src.core.gateways.llms.types import (
    LlmEndpointNotFoundError,
    LlmModelNotAllowedError,
    LlmUpstreamError,
)
from oss.src.core.access.permissions.types import Permission
from oss.src.core.gateways.policy.dtos import CredentialMode, CredentialOwnerKind
from oss.src.core.gateways.policy.types import (
    CeilingExceededError,
    CredentialNotFoundError,
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


async def _chunks(*items: bytes) -> AsyncIterator[bytes]:
    for item in items:
        yield item


def _relay_result(
    *,
    status_code: int = 200,
    chunks: List[bytes],
    headers: Optional[Dict[str, str]] = None,
) -> LlmRelayResult:
    return LlmRelayResult(
        status_code=status_code, headers=headers or {}, body=_chunks(*chunks)
    )


class _MockLlmGatewayService:
    def __init__(
        self,
        *,
        relay_result: Optional[LlmRelayResult] = None,
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
        self, *, scope, namespace, name, body, headers
    ) -> LlmRelayResult:
        self.relay_calls.append(
            {
                "scope": scope,
                "namespace": namespace,
                "name": name,
                "body": body,
                "headers": headers,
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
    proxy = LlmGatewayProxy(llm_gateway_service=service)

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
    proxy = LlmGatewayProxy(llm_gateway_service=service)

    with _auth_scope():
        response = await proxy.chat_completions_custom(
            _request(body=_body(stream=True)), "my-slug"
        )

    assert response.media_type == "text/event-stream"
    assert await _read_body(response) == b"".join(frames)


@pytest.mark.asyncio
async def test_builtin_route_passes_builtin_namespace_and_provider_as_name():
    service = _MockLlmGatewayService(
        relay_result=_relay_result(status_code=200, chunks=[b"{}"])
    )
    proxy = LlmGatewayProxy(llm_gateway_service=service)

    with _auth_scope():
        await proxy.chat_completions_builtin(_request(body=_body()), "openai")

    assert service.relay_calls[0]["namespace"] == GatewayEndpointNamespace.BUILTIN
    assert service.relay_calls[0]["name"] == "openai"


@pytest.mark.asyncio
async def test_custom_route_passes_custom_namespace_and_slug_as_name():
    service = _MockLlmGatewayService(
        relay_result=_relay_result(status_code=200, chunks=[b"{}"])
    )
    proxy = LlmGatewayProxy(llm_gateway_service=service)

    with _auth_scope():
        await proxy.chat_completions_custom(_request(body=_body()), "my-slug")

    assert service.relay_calls[0]["namespace"] == GatewayEndpointNamespace.CUSTOM
    assert service.relay_calls[0]["name"] == "my-slug"


@pytest.mark.asyncio
async def test_inbound_authorization_header_is_stripped_before_the_service_call():
    service = _MockLlmGatewayService(
        relay_result=_relay_result(status_code=200, chunks=[b"{}"])
    )
    proxy = LlmGatewayProxy(llm_gateway_service=service)

    with _auth_scope():
        await proxy.chat_completions_custom(
            _request(body=_body(), headers={"Authorization": "Secret caller-token"}),
            "my-slug",
        )

    assert "authorization" not in {k.lower() for k in service.relay_calls[0]["headers"]}


@pytest.mark.asyncio
async def test_response_headers_drop_upstreams_stale_content_length():
    result = _relay_result(
        status_code=200,
        chunks=[b"hello world"],
        headers={"content-length": "999999", "x-upstream": "yes"},
    )
    service = _MockLlmGatewayService(relay_result=result)
    proxy = LlmGatewayProxy(llm_gateway_service=service)

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
    proxy = LlmGatewayProxy(llm_gateway_service=service)
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
        LlmModelNotAllowedError(
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
        CredentialNotFoundError(
            mode=CredentialMode.PROJECT_ONLY,
            missing=CredentialOwnerKind.PROJECT,
            target="t",
        ),
        404,
        "credential_missing",
    ),
    (
        LlmEndpointNotFoundError(
            namespace=GatewayEndpointNamespace.CUSTOM, name="my-slug"
        ),
        404,
        "endpoint_not_found",
    ),
    (
        LlmUpstreamError(provider_key="openai", status_code=503, detail="down"),
        502,
        "upstream_error",
    ),
    (
        LlmUpstreamError(provider_key="openai", status_code=400, detail="bad"),
        424,
        "upstream_error",
    ),
    (
        LlmUpstreamError(provider_key="openai", status_code=None, detail="timed out"),
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
    proxy = LlmGatewayProxy(llm_gateway_service=service)

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
async def test_ceiling_exceeded_names_the_three_values():
    exc = CeilingExceededError(
        ceiling="max_output_tokens", requested=1000, allowed=100, target="t"
    )
    service = _MockLlmGatewayService(relay_exception=exc)
    proxy = LlmGatewayProxy(llm_gateway_service=service)

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
async def test_list_models_builtin_shapes_the_openai_list_body():
    service = _MockLlmGatewayService(models=["gpt-4o", "gpt-4o-mini"])
    proxy = LlmGatewayProxy(llm_gateway_service=service)

    with _auth_scope():
        result = await proxy.list_models_builtin("openai")

    assert result == {
        "object": "list",
        "data": [
            {"id": "gpt-4o", "object": "model"},
            {"id": "gpt-4o-mini", "object": "model"},
        ],
    }
    assert service.list_models_calls[0]["namespace"] == GatewayEndpointNamespace.BUILTIN
    assert service.list_models_calls[0]["name"] == "openai"


@pytest.mark.asyncio
async def test_list_models_custom_shapes_the_openai_list_body():
    service = _MockLlmGatewayService(models=["mock/echo"])
    proxy = LlmGatewayProxy(llm_gateway_service=service)

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
    exc = LlmEndpointNotFoundError(
        namespace=GatewayEndpointNamespace.CUSTOM, name="missing-slug"
    )
    service = _MockLlmGatewayService(models_exception=exc)
    proxy = LlmGatewayProxy(llm_gateway_service=service)

    with _auth_scope():
        response = await proxy.list_models_custom("missing-slug")

    assert response.status_code == 404
    assert json.loads(response.body)["error"]["code"] == "endpoint_not_found"
