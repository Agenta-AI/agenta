"""Deployable mock OpenAI-compatible LLM server (entities.md §0, D23, WP5).

A standalone ASGI app (`uvicorn oss.src.core.gateways.llms.providers.mock.app:app`),
not mounted into the main API process. It terminates a real HTTP connection and a
real socket, which is what the in-process `MockLlmAdapter` cannot exercise (SSE
framing over the wire, a genuine hang under a client-side timeout) — Checkpoint A's
acceptance suite needs this running as its own compose service.

Delegates every request straight to `MockLlmAdapter` so both tiers share one
implementation of the control convention: a test written against the in-process
adapter and a test written against this process see identical behavior for the
same input.
"""

import json

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse, Response, StreamingResponse

from oss.src.core.gateways.llms.dtos import (
    LlmCallContext,
    LlmDeploymentKind,
    LlmResolvedRoute,
)
from oss.src.core.gateways.llms.providers.mock.adapter import MockLlmAdapter
from oss.src.core.gateways.llms.types import LlmUpstreamError

app = FastAPI(title="agenta-mock-llm-gateway")
_adapter = MockLlmAdapter()


@app.get("/health")
async def health() -> Response:
    return Response(status_code=200)


@app.post("/v1/chat/completions")
async def chat_completions(request: Request) -> Response:
    body = await request.body()
    try:
        payload = json.loads(body) if body else {}
    except (json.JSONDecodeError, TypeError):
        payload = {}

    model = payload.get("model") or "mock/echo"
    stream = bool(payload.get("stream", False))
    context = LlmCallContext(model=model, stream=stream)
    route = LlmResolvedRoute(
        provider_key="mock", deployment=LlmDeploymentKind.DIRECT, model=model
    )

    try:
        result = await _adapter.relay_chat_completion(
            route=route, secret=None, context=context, body=body, headers={}
        )
    except LlmUpstreamError as exc:
        return JSONResponse(
            status_code=exc.status_code or 500,
            content={
                "error": {
                    "message": exc.detail or str(exc),
                    "type": "server_error",
                    "code": "mock_upstream_error",
                }
            },
        )

    if stream:
        return StreamingResponse(
            result.body, media_type="text/event-stream", status_code=result.status_code
        )

    chunks = [chunk async for chunk in result.body]
    return Response(
        content=b"".join(chunks),
        media_type="application/json",
        status_code=result.status_code,
    )
