"""Unit tests for LLMGatewayProxy (entities.md §9, workstreams/specs-wp6.md).

Nothing running: the proxy is exercised against a hand-written mock `LLMGatewayService`
(not WP5's fixture — this is the proxy in isolation) and a Starlette `Request` built from a
raw ASGI scope, no HTTP server.
"""

import json
from contextlib import contextmanager
from typing import Any, AsyncIterator, Dict, List, Optional
from uuid import uuid4

import httpx
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
    LLMUpstreamTimeoutError,
)
from oss.src.core.access.permissions.types import Permission
from oss.src.core.gateways.policy.dtos import SecretMode, SecretOwnerKind
from oss.src.core.gateways.policy.types import (
    CeilingExceededError,
    SecretInvalidError,
    SecretNotFoundError,
    EntitlementDeniedError,
    SpendRefusedError,
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
        self,
        *,
        scope,
        namespace,
        name,
        body,
        headers,
        protocol=None,
        run_id=None,
        run_labels=None,
    ) -> LLMRelayResult:
        self.relay_calls.append(
            {
                "scope": scope,
                "namespace": namespace,
                "name": name,
                "body": body,
                "headers": headers,
                "protocol": protocol,
                "run_id": run_id,
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


def _platform_run(request: Request) -> Request:
    """Authenticate `request` the way a gateway token from a platform agent run does."""
    request.state.token_audience = "gateway"
    request.state.gateway_platform_run = True
    return request


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
async def test_the_run_a_caller_presents_reaches_the_service():
    """The run claim is read off request state, never off the tenant scope, and it is
    what ties a measured call back to its workflow run. A caller on no run passes None."""
    on_a_run = _platform_run(_request(body=_body()))
    on_a_run.state.gateway_run_id = "run-42"
    run_ids = []

    for request in (on_a_run, _platform_run(_request(body=_body()))):
        service = _MockLlmGatewayService(
            relay_result=_relay_result(status_code=200, chunks=[b"{}"])
        )
        with _auth_scope():
            await LLMGatewayProxy(llm_gateway_service=service).chat_completions_builtin(
                request, "mock"
            )
        run_ids.append(service.relay_calls[0]["run_id"])

    assert run_ids == ["run-42", None]


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
async def test_the_callers_authorization_and_cookie_never_enter_the_service():
    service = _MockLlmGatewayService(
        relay_result=_relay_result(status_code=200, chunks=[b"{}"])
    )
    proxy = LLMGatewayProxy(llm_gateway_service=service)

    with _auth_scope():
        await proxy.chat_completions_custom(
            _request(
                body=_body(),
                headers={
                    "Authorization": "Bearer caller-token",
                    "Cookie": "sAccessToken=caller-session",
                    "X-AG-Credentials": "ApiKey gateway-token",
                    "Content-Type": "application/json",
                },
            ),
            "my-slug",
        )

    # OR36: the edge admits headers by allowlist. The caller's Authorization and Cookie
    # authenticate the caller to Agenta, so neither reaches the service, let alone an
    # upstream. An allowlisted header still travels.
    headers = service.relay_calls[0]["headers"]
    normalized = {key.lower(): value for key, value in headers.items()}
    assert "authorization" not in normalized
    assert "cookie" not in normalized
    assert "x-ag-credentials" not in normalized
    assert normalized["content-type"] == "application/json"


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
        SpendRefusedError(
            code="wallet_balance_exhausted", message="Out of credits.", target="t"
        ),
        403,
        "wallet_balance_exhausted",
    ),
    (
        SpendRefusedError(
            code="builtin_models_not_enabled",
            message="Built-in models are not enabled.",
            target="t",
        ),
        403,
        "builtin_models_not_enabled",
    ),
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
    (
        LLMUpstreamError(provider_key="openai", status_code=504, detail="slow"),
        502,
        "upstream_error",
    ),
    (
        LLMUpstreamTimeoutError(provider_key="openai"),
        408,
        "upstream_timeout",
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
    is excluded — D16 forwards the upstream's own detail untouched — and so is
    `upstream_timeout`: both are provider failures, and a marker would make the runner read
    them as an Agenta refusal that retrying cannot fix."""
    service = _MockLlmGatewayService(relay_exception=exc)
    proxy = LLMGatewayProxy(llm_gateway_service=service)

    with _auth_scope():
        response = await proxy.chat_completions_custom(
            _request(body=_body()), "my-slug"
        )

    message = json.loads(response.body)["error"]["message"]
    marker = f"⟦agenta_code:{expected_code}⟧"
    if expected_code in ("upstream_error", "upstream_timeout"):
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


# Responses and Messages routes
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
        # Google's native protocol, for the built-in Gemini endpoint only.
        (
            "/builtin/{provider}/v1beta/models/{model}:streamGenerateContent",
            "POST",
        ): "llm_gateway_gemini_stream_builtin",
        ("/builtin/{provider}/v1/models", "GET"): "llm_gateway_list_models_builtin",
        ("/standard/{provider}/v1/models", "GET"): "llm_gateway_list_models_standard",
        ("/custom/{slug}/v1/models", "GET"): "llm_gateway_list_models_custom",
        # Organization connections an agent named by scope (M5).
        (
            "/organization/{slug}/v1/chat/completions",
            "POST",
        ): "llm_gateway_chat_completions_organization",
        (
            "/organization/{slug}/v1/responses",
            "POST",
        ): "llm_gateway_responses_organization",
        (
            "/organization/{slug}/v1/messages",
            "POST",
        ): "llm_gateway_messages_organization",
        (
            "/organization/{slug}/v1/models",
            "GET",
        ): "llm_gateway_list_models_organization",
    }


# ---------------------------------------------------------------------------
# CodeQL py/stack-trace-exposure: no exception text reaches the response body
# ---------------------------------------------------------------------------

_LEAKY = "INTERNAL-DETAIL-DO-NOT-EXPOSE"


@pytest.mark.asyncio
async def test_an_unrelated_value_error_does_not_reach_the_response_body(monkeypatch):
    """The body arm catches every `ValueError`, not only the gateway's own complaints
    about a request, and it rendered whatever the exception said."""
    import oss.src.apis.fastapi.gateways.llms.proxy as proxy_module

    def explode(*, body):
        raise ValueError(f"connection string {_LEAKY} refused")

    monkeypatch.setattr(proxy_module, "parse_llm_call_context", explode)

    service = _MockLlmGatewayService()
    proxy = LLMGatewayProxy(llm_gateway_service=service)

    with _auth_scope():
        response = await proxy.chat_completions_custom(
            _request(body=json.dumps({"model": "gpt-5"}).encode()), "my-slug"
        )

    assert response.status_code == 400
    assert _LEAKY not in response.body.decode()
    payload = json.loads(response.body)
    assert payload["error"]["code"] == "invalid_request"
    assert service.relay_calls == []


@pytest.mark.asyncio
async def test_a_malformed_body_is_refused_without_quoting_the_decoder():
    """The ordinary way in. A decoder names the offset it choked on in the caller's own
    bytes; the gateway answers in its own words."""
    service = _MockLlmGatewayService()
    proxy = LLMGatewayProxy(llm_gateway_service=service)

    with _auth_scope():
        response = await proxy.chat_completions_custom(
            _request(body=b'{"model": "gpt-5",,,}'), "my-slug"
        )

    assert response.status_code == 400
    rendered = response.body.decode()
    assert "Expecting" not in rendered
    assert "char " not in rendered
    assert "request body is not valid JSON" in rendered


@pytest.mark.asyncio
async def test_an_upstream_failure_does_not_relay_its_adapters_message():
    """The other arm the finding covers: a transport or adapter failure is a fixed
    sentence, and the provider's own text stays server-side."""
    service = _MockLlmGatewayService(
        relay_exception=LLMUpstreamError(
            provider_key="openai", status_code=None, detail=f"boom {_LEAKY}"
        )
    )
    proxy = LLMGatewayProxy(llm_gateway_service=service)

    with _auth_scope():
        response = await proxy.chat_completions_custom(
            _request(body=json.dumps({"model": "gpt-5"}).encode()), "my-slug"
        )

    assert _LEAKY not in response.body.decode()
    payload = json.loads(response.body)
    assert payload["error"]["code"] == "upstream_error"


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "exc",
    [
        SecretNotFoundError(
            mode=SecretMode.PROJECT_ONLY, missing=SecretOwnerKind.PROJECT, target="t"
        ),
        SecretInvalidError(target="t", detail="revoked"),
    ],
)
async def test_a_secret_refusal_tells_the_harness_not_to_retry(exc):
    """409 is a status the Anthropic and OpenAI SDKs retry. Claude Code retried a
    `secret_invalid` for four minutes and the person saw "no first response" instead of
    the message; `x-should-retry: false` is read by both SDKs before the status."""
    service = _MockLlmGatewayService(relay_exception=exc)
    proxy = LLMGatewayProxy(llm_gateway_service=service)

    with _auth_scope():
        response = await proxy.chat_completions_custom(
            _request(body=_body()), "my-slug"
        )

    assert response.status_code == 409
    assert response.headers.get("x-should-retry") == "false"


@pytest.mark.asyncio
async def test_an_upstream_failure_leaves_retrying_to_the_harness():
    service = _MockLlmGatewayService(
        relay_exception=LLMUpstreamError(provider_key="openai", status_code=503)
    )
    proxy = LLMGatewayProxy(llm_gateway_service=service)

    with _auth_scope():
        response = await proxy.chat_completions_custom(
            _request(body=_body()), "my-slug"
        )

    assert "x-should-retry" not in response.headers


# --- a stream that fails after the response started ---------------------------- #


async def _dropped_stream(exc: Exception) -> AsyncIterator[bytes]:
    yield b'data: {"choices":[{"delta":{"content":"Hel"}}]}\n\n'
    yield b'data: {"choices":[{"delta":{"con'
    raise exc


_MARKER = "⟦agenta_code:upstream_error⟧".encode()


def _last_sse_event(body: bytes) -> Dict[str, Any]:
    blocks = [block for block in body.split(b"\n\n") if block.strip()]
    fields = dict(line.split(b": ", 1) for line in blocks[-1].split(b"\n"))
    return {"event": fields.get(b"event"), "data": json.loads(fields[b"data"])}


def _proxy_over(body: AsyncIterator[bytes]) -> LLMGatewayProxy:
    result = LLMRelayResult(status_code=200, headers={}, body=body)
    return LLMGatewayProxy(
        llm_gateway_service=_MockLlmGatewayService(relay_result=result)
    )


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "route, body, event, error_code",
    [
        (
            "chat_completions_custom",
            _body(stream=True),
            None,
            lambda data: data["error"]["code"],
        ),
        (
            "responses_custom",
            _responses_body(stream=True),
            b"error",
            lambda data: data["code"],
        ),
        (
            "messages_custom",
            _messages_body(stream=True),
            b"error",
            lambda data: data["error"]["type"],
        ),
    ],
)
async def test_a_stream_the_upstream_drops_ends_with_a_terminal_error_event(
    route, body, event, error_code
):
    """The upstream closed its socket mid-stream, after the status line was sent. Raised
    out of the `StreamingResponse`, the error left the response unterminated and Traefik
    answered the next request on that keep-alive connection with a 502."""
    proxy = _proxy_over(
        _dropped_stream(
            LLMUpstreamError(provider_key="openai", status_code=None, detail="sk-x")
        )
    )

    with _auth_scope():
        response = await getattr(proxy, route)(_request(body=body), "my-slug")
        relayed = await _read_body(response)

    assert response.status_code == 200
    assert relayed.startswith(b'data: {"choices":[{"delta":{"content":"Hel"}}]}\n\n')
    assert b"sk-x" not in relayed
    assert relayed.endswith(b"\n\n")
    last = _last_sse_event(relayed)
    assert last["event"] == event
    assert error_code(last["data"]) in ("upstream_error", "api_error")
    # The relay's own marked sentence, which the runner reads and Pi retries on.
    assert _MARKER in relayed
    assert b"connection error" in relayed


@pytest.mark.asyncio
async def test_a_stream_that_times_out_mid_way_ends_with_an_upstream_timeout_event():
    proxy = _proxy_over(_dropped_stream(LLMUpstreamTimeoutError(provider_key="openai")))

    with _auth_scope():
        response = await proxy.chat_completions_custom(
            _request(body=_body(stream=True)), "my-slug"
        )
        relayed = await _read_body(response)

    error = _last_sse_event(relayed)["data"]["error"]
    assert error["code"] == "upstream_timeout"
    assert error["message"].startswith("The model provider did not answer in time.")
    assert error["message"].endswith("⟦agenta_code:upstream_error⟧")


@pytest.mark.asyncio
async def test_an_unexpected_failure_mid_stream_still_ends_the_stream_cleanly():
    proxy = _proxy_over(_dropped_stream(RuntimeError("boom")))

    with _auth_scope():
        response = await proxy.chat_completions_custom(
            _request(body=_body(stream=True)), "my-slug"
        )
        relayed = await _read_body(response)

    assert _last_sse_event(relayed)["data"]["error"]["code"] == "upstream_error"
    assert b"boom" not in relayed


@pytest.mark.asyncio
async def test_a_raw_transport_error_mid_stream_ends_cleanly_without_its_text():
    """A route that bypasses the relay's error handling hands the raw httpx error up."""
    proxy = _proxy_over(
        _dropped_stream(httpx.RemoteProtocolError("peer closed connection sk-x"))
    )

    with _auth_scope():
        response = await proxy.chat_completions_custom(
            _request(body=_body(stream=True)), "my-slug"
        )
        relayed = await _read_body(response)

    assert _last_sse_event(relayed)["data"]["error"]["code"] == "upstream_error"
    assert b"sk-x" not in relayed
    assert b"peer closed" not in relayed


@pytest.mark.asyncio
async def test_a_stream_the_client_leaves_closes_the_relayed_body_at_once():
    """The relayed body records the call in its `finally`, which is how a stream the client
    left is still charged. The wrapper must close it when it is closed, not leave it to GC."""
    closed = []

    async def _body_that_records() -> AsyncIterator[bytes]:
        try:
            yield b'data: {"choices":[{"delta":{"content":"Hel"}}]}\n\n'
            yield b'data: {"choices":[{"delta":{"content":"lo"}}]}\n\n'
        finally:
            closed.append(True)

    proxy = _proxy_over(_body_that_records())

    with _auth_scope():
        response = await proxy.chat_completions_custom(
            _request(body=_body(stream=True)), "my-slug"
        )
        await anext(response.body_iterator)
        await response.body_iterator.aclose()

    assert closed == [True]


# --- built-in models are for platform agent runs only ------------------------ #


def _unreadable_request(state: Dict[str, Any]) -> Request:
    """A request whose body fails the test if anything reads it."""
    scope = {"type": "http", "method": "POST", "path": "/", "headers": []}

    async def receive() -> Dict[str, Any]:
        raise AssertionError("the body of a refused built-in call was read")

    request = Request(scope, receive)
    for key, value in state.items():
        setattr(request.state, key, value)
    return request


async def _call_builtin(proxy: LLMGatewayProxy, operation: str, request: Request):
    return await getattr(proxy, operation)(request, "mock")


_BUILTIN_OPERATIONS = [
    "chat_completions_builtin",
    "responses_builtin",
    "messages_builtin",
    "list_models_builtin",
]

# What request state each caller type leaves after authentication.
_REFUSED_CALLERS = {
    # Session cookies and API keys set neither audience nor claim.
    "session_or_api_key": {},
    # The runtime's own general-purpose credential, carrying the vault grant.
    "general_secret_with_grant": {"token_grants": ("secret-resolve",)},
    # A gateway token minted for a user principal, or before this claim existed.
    "gateway_token_without_claim": {"token_audience": "gateway"},
    "gateway_token_claim_false": {
        "token_audience": "gateway",
        "gateway_platform_run": False,
    },
    "gateway_token_claim_not_a_boolean": {
        "token_audience": "gateway",
        "gateway_platform_run": "true",
    },
    # The claim means nothing without the gateway audience.
    "claim_without_gateway_audience": {"gateway_platform_run": True},
}


@pytest.mark.asyncio
@pytest.mark.parametrize("operation", _BUILTIN_OPERATIONS)
@pytest.mark.parametrize("caller", sorted(_REFUSED_CALLERS))
async def test_a_built_in_route_refuses_every_caller_but_a_platform_agent_run(
    operation, caller
):
    service = _MockLlmGatewayService(
        relay_result=_relay_result(chunks=[b"{}"]), models=["gpt-4o"]
    )
    proxy = LLMGatewayProxy(llm_gateway_service=service)

    with _auth_scope():
        response = await _call_builtin(
            proxy, operation, _unreadable_request(_REFUSED_CALLERS[caller])
        )

    assert response.status_code == 403
    error = json.loads(response.body)["error"]
    assert error["code"] == "builtin_requires_agent_run"
    assert error["type"] == "permission_error"
    assert service.relay_calls == []
    assert service.list_models_calls == []


@pytest.mark.asyncio
@pytest.mark.parametrize("operation", _BUILTIN_OPERATIONS)
async def test_a_built_in_route_serves_a_platform_agent_run(operation):
    service = _MockLlmGatewayService(
        relay_result=_relay_result(chunks=[b"{}"]), models=["gpt-4o"]
    )
    proxy = LLMGatewayProxy(llm_gateway_service=service)
    body = {
        "chat_completions_builtin": _body(),
        "responses_builtin": _responses_body(),
        "messages_builtin": _messages_body(),
        "list_models_builtin": b"",
    }[operation]

    with _auth_scope():
        response = await _call_builtin(
            proxy, operation, _platform_run(_request(body=body))
        )

    if operation == "list_models_builtin":
        assert response["data"] == [{"id": "gpt-4o", "object": "model"}]
        assert service.list_models_calls[0]["namespace"] == (
            GatewayEndpointNamespace.BUILTIN
        )
    else:
        assert response.status_code == 200
        assert service.relay_calls[0]["namespace"] == GatewayEndpointNamespace.BUILTIN


@pytest.mark.asyncio
async def test_a_malformed_body_on_a_built_in_route_is_refused_for_the_caller_first():
    service = _MockLlmGatewayService()
    proxy = LLMGatewayProxy(llm_gateway_service=service)

    with _auth_scope():
        response = await proxy.chat_completions_builtin(
            _request(body=b"{not json"), "mock"
        )

    assert response.status_code == 403
    assert json.loads(response.body)["error"]["code"] == "builtin_requires_agent_run"


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "operation",
    [
        "chat_completions_standard",
        "chat_completions_custom",
        "responses_standard",
        "responses_custom",
        "messages_standard",
        "messages_custom",
    ],
)
@pytest.mark.parametrize("caller", sorted(_REFUSED_CALLERS))
async def test_own_connection_routes_do_not_need_a_platform_agent_run(
    operation, caller
):
    """Standard and custom routes spend the caller's own provider key."""
    service = _MockLlmGatewayService(relay_result=_relay_result(chunks=[b"{}"]))
    proxy = LLMGatewayProxy(llm_gateway_service=service)
    body = (
        _responses_body()
        if operation.startswith("responses")
        else _messages_body()
        if operation.startswith("messages")
        else _body()
    )
    request = _request(body=body)
    for key, value in _REFUSED_CALLERS[caller].items():
        setattr(request.state, key, value)

    with _auth_scope():
        response = await getattr(proxy, operation)(request, "my-connection")

    assert response.status_code == 200
    assert len(service.relay_calls) == 1


@pytest.mark.asyncio
@pytest.mark.parametrize("operation", ["list_models_standard", "list_models_custom"])
async def test_own_connection_model_lists_do_not_need_a_platform_agent_run(operation):
    service = _MockLlmGatewayService(models=["gpt-4o"])
    proxy = LLMGatewayProxy(llm_gateway_service=service)

    with _auth_scope():
        result = await getattr(proxy, operation)("my-connection")

    assert result["data"] == [{"id": "gpt-4o", "object": "model"}]
