"""Deployable mock OpenAI-compatible LLM server (entities.md §0, D23, WP5).

A standalone ASGI app (`uvicorn oss.src.core.gateways.llms.providers.mock.app:app`),
not mounted into the main API process. It terminates a real HTTP connection and a
real socket, which is what the in-process `MockLLMAdapter` cannot exercise (SSE
framing over the wire, a genuine hang under a client-side timeout) — Checkpoint A's
acceptance suite needs this running as its own compose service.

Delegates every request straight to `MockLLMAdapter` so both tiers share one
implementation of the control convention: a test written against the in-process
adapter and a test written against this process see identical behavior for the
same input.
"""

import json

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse, Response, StreamingResponse

from oss.src.core.gateways.llms.dtos import (
    LLMCallContext,
    LLMDeploymentKind,
    LLMProtocol,
    LLMResolvedRoute,
)
from oss.src.core.gateways.llms.providers.mock.adapter import MockLLMAdapter
from oss.src.core.gateways.llms.types import LLMUpstreamError
from oss.src.utils.env import env

app = FastAPI(title="agenta-mock-llm-gateway")
_adapter = MockLLMAdapter()


def _profile(request: Request) -> str:
    return request.headers.get("X-Agenta-Mock-Profile", "llm-custom")


def _protected(request: Request) -> Response | None:
    # Direct mock contract tests remain unauthenticated.  Gateway acceptance
    # selects a named profile, which opts into the credential-injection proof.
    if not env.mock_gateways.enabled or "X-Agenta-Mock-Profile" not in request.headers:
        return None
    expected = f"Bearer {env.mock_gateways.upstream_token}"
    if request.headers.get("Authorization") != expected:
        return JSONResponse(
            status_code=401,
            content={"error": {"message": "mock upstream credential rejected"}},
        )
    return None


@app.get("/health")
async def health() -> Response:
    return Response(status_code=200)


@app.post("/__echo/v1/chat/completions")
async def echo_headers(request: Request) -> Response:
    """Report the headers this process received (launch-2.md D39).

    On the completions path rather than a bare route so it is reachable THROUGH the gateway:
    an endpoint whose `base_url` ends in `/__echo` relays here, and the answer is the only
    proof that `X-AG-Credentials` was stripped and a passed-through `Authorization` arrived.
    """
    return JSONResponse(content={"headers": dict(request.headers)})


async def _relay(request: Request, *, protocol: LLMProtocol) -> Response:
    denied = _protected(request)
    if denied is not None:
        return denied

    profile = _profile(request)
    body = await request.body()
    try:
        payload = json.loads(body) if body else {}
    except (json.JSONDecodeError, TypeError):
        payload = {}

    model = payload.get("model") or "mock/echo"
    stream = bool(payload.get("stream", False))
    context = LLMCallContext(model=model, stream=stream, protocol=protocol)
    route = LLMResolvedRoute(
        provider_key="mock", deployment_kind=LLMDeploymentKind.MOCK, model=model
    )

    try:
        result = await _adapter.relay_chat_completion(
            route=route, secret=None, context=context, body=body, headers={}
        )
    except LLMUpstreamError as exc:
        return JSONResponse(
            status_code=exc.status_code or 500,
            content={
                "error": {
                    "message": "mock upstream request failed",
                    "type": "server_error",
                    "code": "mock_upstream_error",
                }
            },
            headers={"X-Agenta-Mock-Profile": profile},
        )

    if stream:
        return StreamingResponse(
            result.body,
            media_type="text/event-stream",
            status_code=result.status_code,
            headers={"X-Agenta-Mock-Profile": profile},
        )

    chunks = [chunk async for chunk in result.body]
    return Response(
        content=b"".join(chunks),
        media_type="application/json",
        status_code=result.status_code,
        headers={"X-Agenta-Mock-Profile": profile},
    )


@app.post("/v1/chat/completions")
async def chat_completions(request: Request) -> Response:
    return await _relay(request, protocol=LLMProtocol.CHAT_COMPLETIONS)


@app.post("/v1/responses")
async def responses(request: Request) -> Response:
    return await _relay(request, protocol=LLMProtocol.RESPONSES)


@app.post("/v1/messages")
async def messages(request: Request) -> Response:
    return await _relay(request, protocol=LLMProtocol.MESSAGES)


# WP32's private-cloud fixture surface. These are deliberately explicit rather
# than a catch-all route: a test proves the real Bedrock/Vertex protocol tails
# composed by routing.py reached this local socket.
@app.post("/anthropic/v1/messages")
async def bedrock_messages(request: Request) -> Response:
    return await _relay(request, protocol=LLMProtocol.MESSAGES)


@app.post(
    "/v1/projects/{project}/locations/{location}/endpoints/openapi/chat/completions"
)
async def vertex_chat_completions(
    request: Request,
    project: str,
    location: str,  # noqa: ARG001
) -> Response:
    return await _relay(request, protocol=LLMProtocol.CHAT_COMPLETIONS)


@app.post("/v1/projects/{project}/locations/{location}/endpoints/openapi/responses")
async def vertex_responses(
    request: Request,
    project: str,
    location: str,  # noqa: ARG001
) -> Response:
    return await _relay(request, protocol=LLMProtocol.RESPONSES)


@app.post(
    "/v1/projects/{project}/locations/{location}/publishers/anthropic/models/{model_action}"
)
async def vertex_messages(
    request: Request,
    project: str,
    location: str,
    model_action: str,  # noqa: ARG001
) -> Response:
    return await _relay(request, protocol=LLMProtocol.MESSAGES)
