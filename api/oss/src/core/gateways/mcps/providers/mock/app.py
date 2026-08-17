"""Deployable mock MCP Streamable HTTP server (entities.md §0, D23, WP5).

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

app = FastAPI(title="agenta-mock-mcp-gateway")
_adapter = MockMCPAdapter()
_route = MCPResolvedRoute(url="http://mock-mcp-gateway:9092/")
_auth = MCPDirectAuth(secret=None)


@app.get("/health")
async def health() -> Response:
    return Response(status_code=200)


@app.post("/__echo")
async def echo_headers(request: Request) -> Response:
    """Report the headers this process received (launch-2.md D39).

    Reachable through the gateway by pointing an endpoint's `base_url` at `/__echo`: the MCP
    relay POSTs to `base_url` directly, so the answer is what the upstream really saw.
    """
    return JSONResponse(content={"headers": dict(request.headers)})


@app.post("/")
async def relay(request: Request) -> Response:
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
            content=(exc.detail or str(exc)).encode(),
            media_type="text/plain",
        )

    if result.status_code == 202:
        return Response(status_code=202)

    return Response(
        status_code=result.status_code,
        content=result.body,
        media_type="application/json",
    )


@app.get("/")
async def reject_get() -> Response:
    return Response(status_code=405)


@app.delete("/")
async def reject_delete() -> Response:
    return Response(status_code=405)
