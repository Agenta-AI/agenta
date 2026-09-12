"""Deployable mock MCP Streamable HTTP server.

A standalone ASGI app (`uvicorn oss.src.core.gateways.mcps.providers.mock.app:app`),
not mounted into the main API process. Stateless JSON mode: one JSON-RPC request in,
one `application/json` response out, `202` for a notification — the same shape as
the runner's internal tool server (services/runner/src/tools/tool-mcp-http.ts), no
session id, no SSE leg. `GET`/`DELETE` answer `405`.

Delegates every POST straight to `MockMCPAdapter` so both tiers share one
implementation of the control convention.
"""

import json

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse, Response

from oss.src.core.gateways.mcps.dtos import (
    MCPCallContext,
    MCPDirectAuth,
    MCPResolvedRoute,
)
from oss.src.core.gateways.mcps.providers.mock.adapter import MockMCPAdapter
from oss.src.core.gateways.mcps.types import MCPUpstreamError
from oss.src.utils.env import env

app = FastAPI(title="agenta-mock-mcp-gateway")
_adapter = MockMCPAdapter()
_route = MCPResolvedRoute(url="http://mock-mcp-gateway:9092/")
_auth = MCPDirectAuth(secret=None)


def _profile(request: Request) -> str:
    return request.headers.get("X-Agenta-Mock-Profile", "mcp-custom")


def _protected(request: Request) -> Response | None:
    # Direct mock contract tests remain unauthenticated.  Gateway acceptance
    # selects a named profile, which opts into the credential-injection proof.
    if not env.mock_gateways.enabled or "X-Agenta-Mock-Profile" not in request.headers:
        return None
    expected = f"Bearer {env.mock_gateways.upstream_token}"
    if request.headers.get("Authorization") != expected:
        return JSONResponse(
            status_code=401,
            content={"error": "mock upstream credential rejected"},
        )
    return None


@app.get("/health")
async def health() -> Response:
    return Response(status_code=200)


@app.post("/__echo")
async def echo_headers(request: Request) -> Response:
    """Report the headers this process received.

    Reachable through the gateway by pointing an endpoint's `base_url` at `/__echo`: the MCP
    relay POSTs to `base_url` directly, so the answer is what the upstream really saw.
    """
    return JSONResponse(content={"headers": dict(request.headers)})


@app.post("/")
async def relay(request: Request) -> Response:
    denied = _protected(request)
    if denied is not None:
        return denied

    profile = _profile(request)
    body = await request.body()
    try:
        payload = json.loads(body) if body else {}
    except (json.JSONDecodeError, TypeError):
        payload = {}

    context = MCPCallContext(method=payload.get("method", ""))

    try:
        result = await _adapter.relay(
            route=_route,
            auth=_auth,
            context=context,
            body=body,
            headers=dict(request.headers),
        )
    except MCPUpstreamError as exc:
        return Response(
            status_code=exc.status_code or 502,
            content=b"mock upstream request failed",
            media_type="text/plain",
        )

    if result.status_code == 202:
        return Response(status_code=202, headers={"X-Agenta-Mock-Profile": profile})

    return Response(
        status_code=result.status_code,
        content=result.body,
        media_type="application/json",
        headers={"X-Agenta-Mock-Profile": profile},
    )


@app.get("/")
async def reject_get() -> Response:
    return Response(status_code=405)


@app.delete("/")
async def reject_delete() -> Response:
    return Response(status_code=405)
