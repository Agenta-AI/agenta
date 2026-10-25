"""The built-in Gemini endpoint's native door (`docs/design/gemini-native-door`).

Pi's Google client sends Vertex's own `streamGenerateContent` request; the gateway relays it
to Vertex's native operation on the platform's account, and relays the answer as received.
The relay runs for real (`RelayLLMAdapter` over an `httpx` transport double).
"""

import asyncio
import json
from typing import List

import httpx
import pytest
from starlette.requests import Request

from oss.src.apis.fastapi.gateways.llms.proxy import LLMGatewayProxy
from oss.src.core.gateways.dtos import GatewayEndpointNamespace
from oss.src.core.gateways.llms.dtos import LLMCallContext, LLMProtocol
from oss.src.core.gateways.llms.providers.passthrough.adapter import (
    RelayLLMAdapter,
    _usage_from_payload,
)
from oss.src.core.gateways.llms.providers.passthrough.static_fields import (
    normalize_gemini_thinking,
    nudge_stalled_gemini,
)
from oss.src.core.gateways.llms.registry import LLMUpstreamRegistry
from oss.src.core.gateways.llms.service import LLMGatewayService
from oss.src.core.gateways.llms.types import (
    LLMCapabilityNotAllowedError,
    LLMModelNotAllowedError,
)
from oss.src.core.gateways.policy.dtos import GatewayUsage
from oss.tests.pytest.unit.gateways.test_gateways_builtin_agenta import (  # noqa: F401
    _TOKEN,
    _AdmittingPolicy,
    _NoRows,
    _NoVault,
    _Policy,
    _scope,
    vertex,
)
from oss.tests.pytest.unit.gateways.test_gateways_llm_proxy import (
    _MockLlmGatewayService,
    _auth_scope,
    _platform_run,
    _read_body,
    _relay_result,
)

# Every test runs with the platform's Vertex credential configured (`vertex`).
pytestmark = pytest.mark.usefixtures("vertex")

_USAGE = {
    "promptTokenCount": 14713,
    "cachedContentTokenCount": 12256,
    "candidatesTokenCount": 17,
    "thoughtsTokenCount": 51,
    "totalTokenCount": 14781,
    "trafficType": "ON_DEMAND",
}


def _event(parts, *, finish=None, usage=None) -> dict:
    candidate = {"content": {"role": "model", "parts": parts}}
    if finish:
        candidate["finishReason"] = finish
    event = {"candidates": [candidate], "responseId": "resp-1"}
    if usage:
        event["usageMetadata"] = usage
    return event


def _sse(*events) -> bytes:
    return "".join(f"data: {json.dumps(e)}\r\n\r\n" for e in events).encode()


_HI = _sse(
    _event([{"text": "Hi"}], usage={"trafficType": "ON_DEMAND"}),
    _event([{"text": "", "thoughtSignature": "c2ln"}], finish="STOP", usage=_USAGE),
)

_REQUEST = {
    "contents": [{"role": "user", "parts": [{"text": "hi"}]}],
    "systemInstruction": {"parts": [{"text": "Be terse."}]},
    "tools": [
        {
            "functionDeclarations": [
                {"name": "bash", "parametersJsonSchema": {"type": "object"}}
            ]
        }
    ],
    "generationConfig": {
        "maxOutputTokens": 1000,
        "thinkingConfig": {"thinkingBudget": 0},
    },
}


class _Scripted(httpx.AsyncBaseTransport):
    """Answers each attempt by script: "stall" never answers, an int is that status with a
    Vertex error body, bytes are a 200 native stream."""

    def __init__(self, *script):
        self.script = list(script)
        self.requests: List[httpx.Request] = []

    async def handle_async_request(self, request):
        self.requests.append(request)
        step = self.script[min(len(self.requests), len(self.script)) - 1]
        if step == "stall":
            await asyncio.Event().wait()
        if isinstance(step, int):
            return httpx.Response(
                step,
                json={
                    "error": {
                        "code": step,
                        "message": "Resource exhausted in project agenta-prod.",
                        "status": "RESOURCE_EXHAUSTED",
                    }
                },
            )
        return httpx.Response(
            200, content=step, headers={"content-type": "text/event-stream"}
        )


def _service(transport, policy=None) -> LLMGatewayService:
    return LLMGatewayService(
        llm_endpoints_dao=_NoRows(),
        policy=policy or _Policy(),
        resolver=_NoVault(),
        upstream_registry=LLMUpstreamRegistry(
            adapters={
                "relay": RelayLLMAdapter(client=httpx.AsyncClient(transport=transport))
            }
        ),
    )


async def _native(service, body=None, *, model="gemini-3.8-flash", headers=None):
    result = await service.relay_chat_completion(
        scope=_scope(),
        namespace=GatewayEndpointNamespace.BUILTIN,
        name="agenta",
        body=json.dumps(body if body is not None else _REQUEST).encode(),
        headers=headers or {},
        protocol=LLMProtocol.GEMINI,
        context=LLMCallContext(
            model=f"google/{model}", stream=True, protocol=LLMProtocol.GEMINI
        ),
    )
    return result, b"".join([chunk async for chunk in result.body])


# --- the relay ----------------------------------------------------------------- #


@pytest.mark.asyncio
async def test_a_native_call_reaches_vertex_natively_and_is_charged_from_its_usage():
    transport = _Scripted(_HI)
    policy = _AdmittingPolicy()

    result, received = await _native(_service(transport, policy))

    (request,) = transport.requests
    assert request.headers["host"] == "aiplatform.googleapis.com"
    assert request.url.path == (
        "/v1/projects/agenta-test-project/locations/global/publishers/google/models"
        "/gemini-3.8-flash:streamGenerateContent"
    )
    assert request.url.params["alt"] == "sse"
    assert request.headers["authorization"] == f"Bearer {_TOKEN}"
    sent = json.loads(request.content)
    # Relayed as Pi sent it, but for the thinking level: "off" becomes LOW.
    assert sent["contents"] == _REQUEST["contents"]
    assert sent["tools"] == _REQUEST["tools"]
    assert sent["generationConfig"] == {
        "maxOutputTokens": 1000,
        "thinkingConfig": {"thinkingLevel": "LOW"},
    }
    # The answer reaches the caller byte for byte.
    assert result.status_code == 200
    assert received == _HI
    assert len(policy.admitted) == 1
    ((_target, outcome),) = policy.records
    assert outcome.usage == GatewayUsage(
        input_tokens=2457, cache_read_tokens=12256, output_tokens=68
    )


@pytest.mark.asyncio
async def test_the_placeholder_google_key_never_reaches_vertex():
    transport = _Scripted(_HI)

    await _native(_service(transport), headers={"x-goog-api-key": "agenta-gateway"})

    assert "x-goog-api-key" not in transport.requests[0].headers


@pytest.mark.asyncio
async def test_a_model_outside_the_allowlist_is_refused():
    with pytest.raises(LLMModelNotAllowedError):
        await _native(_service(_Scripted(_HI)), model="gemini-3.1-pro")


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "change, field",
    [
        ({"cachedContent": "projects/p/cachedContents/c"}, "cachedContent"),
        ({"labels": {"a": "b"}}, "labels"),
        ({"generation_config": {}}, "generation_config"),
        ({"tools": [{"googleSearch": {}}]}, "tools"),
        (
            {"tools": [{"functionDeclarations": [], "codeExecution": {}}]},
            "tools",
        ),
        (
            {"generationConfig": {"routingConfig": {"autoMode": {}}}},
            "generationConfig.routingConfig",
        ),
        (
            {"generationConfig": {"responseModalities": ["AUDIO"]}},
            "generationConfig.responseModalities",
        ),
        (
            {"generationConfig": {"candidateCount": 2}},
            "generationConfig.candidateCount",
        ),
        (
            {
                "contents": [
                    {
                        "role": "user",
                        "parts": [{"fileData": {"fileUri": "https://x.example/a.pdf"}}],
                    }
                ]
            },
            "contents.parts.fileData",
        ),
        (
            {
                "contents": [
                    {
                        "role": "user",
                        "parts": [
                            {
                                "functionResponse": {
                                    "name": "bash",
                                    "response": {"output": "ok"},
                                    "parts": [
                                        {"fileData": {"fileUri": "gs://b/a.pdf"}}
                                    ],
                                }
                            }
                        ],
                    }
                ]
            },
            "contents.parts.functionResponse.parts.fileData",
        ),
        ({"systemInstruction": "Be terse."}, "systemInstruction"),
        (
            {"toolConfig": {"retrievalConfig": {"latLng": {}}}},
            "toolConfig.retrievalConfig",
        ),
        (
            {"tools": [{"functionDeclarations": [{"name": "f", "behavior": "X"}]}]},
            "tools.functionDeclarations.behavior",
        ),
        (
            {"generationConfig": {"thinkingConfig": {"thinking_level": "HIGH"}}},
            "generationConfig.thinkingConfig.thinking_level",
        ),
        (
            {"safetySettings": [{"category": "X", "threshold": "Y", "extra": 1}]},
            "safetySettings.extra",
        ),
        (
            {"systemInstruction": {"parts": [{"fileData": {"fileUri": "gs://b/a"}}]}},
            "systemInstruction.parts.fileData",
        ),
        (
            {
                "contents": [
                    {
                        "role": "user",
                        "parts": [
                            {
                                "inlineData": {
                                    "mimeType": "image/png",
                                    "data": "AAAA",
                                    "fileUri": "gs://b/a",
                                }
                            }
                        ],
                    }
                ]
            },
            "contents.parts.inlineData.fileUri",
        ),
        (
            {"toolConfig": {"functionCallingConfig": {"mode": "ANY", "streamArgs": 1}}},
            "toolConfig.functionCallingConfig.streamArgs",
        ),
        ({"contents": {"role": "user"}}, "contents"),
        ({"contents": [{"role": "user", "parts": "hi"}]}, "contents.parts"),
        ({"contents": [{"role": "user", "parts": ["hi"]}]}, "contents.parts"),
        (
            {"tools": [{"functionDeclarations": {"name": "f"}}]},
            "tools.functionDeclarations",
        ),
        ({"generationConfig": "fast"}, "generationConfig"),
        ({"safetySettings": {"category": "X"}}, "safetySettings"),
    ],
)
async def test_a_field_the_built_in_endpoint_does_not_price_is_refused(change, field):
    transport = _Scripted(_HI)
    with pytest.raises(LLMCapabilityNotAllowedError) as refused:
        await _native(_service(transport), {**_REQUEST, **change})

    assert refused.value.field == field
    # Refused before the platform's account is reached.
    assert transport.requests == []


@pytest.mark.asyncio
async def test_inline_media_and_thought_signatures_pass():
    transport = _Scripted(_HI)
    body = {
        **_REQUEST,
        "contents": [
            {
                "role": "user",
                "parts": [
                    {"text": "Look"},
                    {"inlineData": {"mimeType": "image/png", "data": "AAAA"}},
                ],
            },
            {
                "role": "model",
                "parts": [
                    {
                        "functionCall": {"name": "bash", "args": {}, "id": "c1"},
                        "thoughtSignature": "c2ln",
                    }
                ],
            },
            {
                "role": "user",
                "parts": [
                    {
                        "functionResponse": {
                            "name": "bash",
                            "id": "c1",
                            "response": {"output": "ok"},
                        }
                    }
                ],
            },
        ],
        "generationConfig": {
            "candidateCount": 1,
            "thinkingConfig": {"thinkingLevel": "HIGH", "includeThoughts": True},
        },
    }

    await _native(_service(transport), body)

    sent = json.loads(transport.requests[0].content)
    assert sent["contents"] == body["contents"]
    assert sent["generationConfig"]["thinkingConfig"] == {
        "thinkingLevel": "HIGH",
        "includeThoughts": True,
    }


@pytest.mark.asyncio
async def test_a_stalled_native_call_is_retried_with_its_system_instruction_nudged(
    monkeypatch,
):
    import oss.src.core.gateways.llms.catalog as catalog_module

    monkeypatch.setattr(catalog_module, "AGENTA_RESPONSE_HEADERS_TIMEOUT_SECONDS", 0.05)
    transport = _Scripted("stall", "stall", _HI)
    policy = _AdmittingPolicy()

    _result, received = await _native(_service(transport, policy))

    assert received == _HI
    texts = [
        json.loads(r.content)["systemInstruction"]["parts"][0]["text"]
        for r in transport.requests
    ]
    assert texts == ["Be terse.", "Be terse.\n", "Be terse.\n\n"]
    assert len(policy.admitted) == 1
    assert len(policy.records) == 1


@pytest.mark.asyncio
async def test_a_vertex_error_reaches_the_caller_in_googles_shape_without_vertexs_words(
    monkeypatch,
):
    async def _no_wait(*_args, **_kwargs):
        return None

    monkeypatch.setattr(asyncio, "sleep", _no_wait)

    result, received = await _native(_service(_Scripted(400)))

    assert result.status_code == 400
    error = json.loads(received)["error"]
    assert error["code"] == 400
    assert error["status"] == "INVALID_ARGUMENT"
    assert "⟦agenta_code:" in error["message"]
    assert "agenta-prod" not in received.decode()


@pytest.mark.asyncio
async def test_a_stream_that_ends_with_a_finish_reason_is_not_a_lost_connection():
    _result, received = await _native(_service(_Scripted(_HI)))

    assert b"connection" not in received.lower()


@pytest.mark.asyncio
async def test_a_stream_cut_before_its_finish_reason_ends_with_a_google_error():
    class _Breaks(httpx.AsyncBaseTransport):
        async def handle_async_request(self, request):
            async def body():
                yield _sse(_event([{"text": "Hel"}]))
                raise httpx.ReadError("connection reset")

            return httpx.Response(
                200, content=body(), headers={"content-type": "text/event-stream"}
            )

    _result, received = await _native(_service(_Breaks()))

    last = received.decode().strip().split("data: ")[-1]
    error = json.loads(last)["error"]
    assert error["status"] == "UNAVAILABLE"
    assert "⟦agenta_code:" in error["message"]


# --- helpers --------------------------------------------------------------------- #


@pytest.mark.parametrize(
    "thinking, expected",
    [
        (None, {"thinkingLevel": "LOW"}),
        ({}, {"thinkingLevel": "LOW"}),
        ({"thinkingBudget": 0}, {"thinkingLevel": "LOW"}),
        ({"thinkingLevel": "MINIMAL"}, {"thinkingLevel": "LOW"}),
        ({"thinkingLevel": "high"}, {"thinkingLevel": "HIGH"}),
        (
            {"thinkingLevel": "MEDIUM", "includeThoughts": True},
            {"thinkingLevel": "MEDIUM", "includeThoughts": True},
        ),
        # Pi's budget for any level on gemini-4-argon: Vertex's default level applies.
        ({"thinkingBudget": -1, "includeThoughts": True}, {"includeThoughts": True}),
        ({"thinkingBudget": 2048}, {}),
        # A null config is an unset one, so it gets the default too.
        ("null-thinking", {"thinkingLevel": "LOW"}),
        ("null-generation", {"thinkingLevel": "LOW"}),
    ],
)
def test_thinking_is_normalized_to_a_level_the_built_in_models_accept(
    thinking, expected
):
    body = {"contents": []}
    if thinking == "null-thinking":
        body["generationConfig"] = {"thinkingConfig": None}
    elif thinking == "null-generation":
        body["generationConfig"] = None
    elif thinking is not None:
        body["generationConfig"] = {"thinkingConfig": thinking}

    sent = json.loads(normalize_gemini_thinking(json.dumps(body).encode()))

    assert sent["generationConfig"]["thinkingConfig"] == expected


def test_a_request_without_a_system_instruction_is_retried_unchanged():
    raw = json.dumps({"contents": []}).encode()

    assert nudge_stalled_gemini(raw, attempts=1) == raw


def test_native_usage_counts_tool_use_prompt_as_input_and_never_reads_the_total():
    usage = _usage_from_payload(
        {
            "usageMetadata": {
                "promptTokenCount": 100,
                "toolUsePromptTokenCount": 20,
                "cachedContentTokenCount": 30,
                "candidatesTokenCount": 5,
                "thoughtsTokenCount": 7,
                "totalTokenCount": 999,
            }
        },
        LLMProtocol.GEMINI,
    )

    assert usage == GatewayUsage(
        input_tokens=90, cache_read_tokens=30, output_tokens=12
    )


def test_an_event_without_counts_reports_no_usage():
    assert (
        _usage_from_payload(
            {"usageMetadata": {"trafficType": "ON_DEMAND"}}, LLMProtocol.GEMINI
        )
        is None
    )


@pytest.mark.asyncio
async def test_the_built_in_vertex_endpoint_advertises_the_native_protocol():
    service = LLMGatewayService(
        llm_endpoints_dao=_NoRows(),
        policy=_Policy(),
        resolver=_NoVault(),
        upstream_registry=LLMUpstreamRegistry(adapters={}),
    )

    resolution = await service.resolve_agent_connection(
        scope=_scope(),
        model="google/gemini-3.8-flash",
        provider_key="openai",
        connection_slug="agenta",
        connection_namespace=GatewayEndpointNamespace.BUILTIN,
    )

    # Older harnesses keep reading the OpenAI-compatible route; newer ones read `protocol`.
    assert resolution.provider_key == "openai"
    assert resolution.protocol is LLMProtocol.GEMINI


# --- the door ------------------------------------------------------------------- #


def _native_request(body: bytes) -> Request:
    scope = {"type": "http", "method": "POST", "path": "/", "headers": []}

    async def receive():
        return {"type": "http.request", "body": body, "more_body": False}

    return Request(scope, receive)


@pytest.mark.asyncio
async def test_the_door_names_the_model_from_the_path_and_streams_the_answer():
    service = _MockLlmGatewayService(relay_result=_relay_result(chunks=[_HI]))
    calls = []
    original = service.relay_chat_completion

    async def relay(**kwargs):
        calls.append(kwargs.pop("context"))
        return await original(**kwargs)

    service.relay_chat_completion = relay
    proxy = LLMGatewayProxy(llm_gateway_service=service)

    with _auth_scope():
        response = await proxy.gemini_stream_builtin(
            _platform_run(_native_request(json.dumps(_REQUEST).encode())),
            "agenta",
            "gemini-3.8-flash",
        )

    assert response.status_code == 200
    assert await _read_body(response) == _HI
    assert calls == [
        LLMCallContext(
            model="google/gemini-3.8-flash", stream=True, protocol=LLMProtocol.GEMINI
        )
    ]
    assert service.relay_calls[0]["protocol"] is LLMProtocol.GEMINI


@pytest.mark.asyncio
@pytest.mark.parametrize("model", ["google/gemini-3.8-flash", "..", "gemini 3"])
async def test_the_door_refuses_a_model_id_that_is_not_bare(model):
    proxy = LLMGatewayProxy(llm_gateway_service=_MockLlmGatewayService())

    with _auth_scope():
        response = await proxy.gemini_stream_builtin(
            _platform_run(_native_request(b"{}")), "agenta", model
        )

    assert response.status_code == 400
    assert json.loads(response.body)["error"]["status"] == "INVALID_ARGUMENT"


@pytest.mark.asyncio
async def test_a_call_outside_an_agent_run_is_refused_in_googles_shape():
    proxy = LLMGatewayProxy(llm_gateway_service=_MockLlmGatewayService())

    with _auth_scope():
        response = await proxy.gemini_stream_builtin(
            _native_request(json.dumps(_REQUEST).encode()), "agenta", "gemini-3.8-flash"
        )

    assert response.status_code == 403
    error = json.loads(response.body)["error"]
    assert error == {
        "code": 403,
        "message": error["message"],
        "status": "PERMISSION_DENIED",
    }
    assert "builtin_requires_agent_run" in error["message"]


@pytest.mark.asyncio
async def test_a_refusal_from_the_service_is_answered_in_googles_shape():
    service = _MockLlmGatewayService(
        relay_exception=LLMCapabilityNotAllowedError(
            field="tools", namespace=GatewayEndpointNamespace.BUILTIN, name="agenta"
        )
    )
    original = service.relay_chat_completion

    async def relay(**kwargs):
        kwargs.pop("context")
        return await original(**kwargs)

    service.relay_chat_completion = relay
    proxy = LLMGatewayProxy(llm_gateway_service=service)

    with _auth_scope():
        response = await proxy.gemini_stream_builtin(
            _platform_run(_native_request(json.dumps(_REQUEST).encode())),
            "agenta",
            "gemini-3.8-flash",
        )

    assert response.status_code == 400
    error = json.loads(response.body)["error"]
    assert error["status"] == "INVALID_ARGUMENT"
    assert error["message"]


@pytest.mark.parametrize(
    "path, model",
    [
        (
            "/builtin/agenta/v1beta/models/gemini-3.8-flash:streamGenerateContent",
            "gemini-3.8-flash",
        ),
        (
            "/builtin/agenta/v1beta/models/gemini-4-argon:streamGenerateContent",
            "gemini-4-argon",
        ),
    ],
)
def test_the_route_matches_the_path_googles_sdk_calls(path, model):
    from starlette.routing import Match

    proxy = LLMGatewayProxy(llm_gateway_service=_MockLlmGatewayService())
    (route,) = [r for r in proxy.router.routes if r.name == "gemini_stream_builtin"]

    match, child = route.matches({"type": "http", "path": path, "method": "POST"})

    assert match is Match.FULL
    assert child["path_params"] == {"provider": "agenta", "model": model}


@pytest.mark.asyncio
@pytest.mark.parametrize("body", [b"not json", b"[1, 2]", b"\xff\xfe", b""])
async def test_a_body_that_is_not_a_json_object_is_refused_in_googles_shape(body):
    service = _MockLlmGatewayService(relay_result=_relay_result(chunks=[_HI]))
    proxy = LLMGatewayProxy(llm_gateway_service=service)

    with _auth_scope():
        response = await proxy.gemini_stream_builtin(
            _platform_run(_native_request(body)), "agenta", "gemini-3.8-flash"
        )

    assert response.status_code == 400
    assert json.loads(response.body)["error"]["status"] == "INVALID_ARGUMENT"
    assert service.relay_calls == []


@pytest.mark.asyncio
async def test_opaque_arguments_responses_and_schemas_pass_unchecked():
    """The allowlist checks protocol objects, not what the model and tools put inside them."""
    transport = _Scripted(_HI)
    odd = {"fileData": {"fileUri": "gs://b/a"}, "routingConfig": 1, "anything": [1]}
    body = {
        **_REQUEST,
        "tools": [
            {
                "functionDeclarations": [
                    {
                        "name": "f",
                        "parametersJsonSchema": {"type": "object", "properties": odd},
                    }
                ]
            }
        ],
        "contents": [
            {
                "role": "model",
                "parts": [{"functionCall": {"name": "f", "args": odd, "id": "c1"}}],
            },
            {
                "role": "user",
                "parts": [
                    {"functionResponse": {"name": "f", "id": "c1", "response": odd}}
                ],
            },
        ],
    }

    await _native(_service(transport), body)

    assert json.loads(transport.requests[0].content)["contents"] == body["contents"]
