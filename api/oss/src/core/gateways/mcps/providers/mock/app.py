"""Deployable mock MCP Streamable HTTP server.

A standalone ASGI app (`uvicorn oss.src.core.gateways.mcps.providers.mock.app:app`),
not mounted into the main API process. Stateless JSON mode: one JSON-RPC request in,
one `application/json` response out, `202` for a notification — the same shape as
the runner's internal tool server (services/runner/src/tools/tool-mcp-http.ts), no
session id, no SSE leg. `GET`/`DELETE` answer `405`.

Delegates every POST straight to `MockMCPAdapter` so both tiers share one
implementation of the control convention, including the opening handshake and the
JSON-RPC error an unknown method gets. Both tiers therefore answer any given
request with the same bytes, which is the only way a client debugged against one
can be trusted against the other.

While `AGENTA_GATEWAYS_MOCKS_ENABLED` is on, this process also serves a mock OAuth
authorization server and a second, OAuth-protected MCP surface at `/oauth/mcp`
(`issuer.py`), and a third, header-authenticated surface at `/key/mcp`. `/` stays
unauthenticated, because every other mock suite speaks to it.
"""

import json

from fastapi import APIRouter, FastAPI, Request
from fastapi.responses import JSONResponse, Response

from oss.src.core.gateways.mcps.dtos import (
    MCPCallContext,
    MCPDirectAuth,
    MCPResolvedRoute,
)
from oss.src.core.gateways.mcps.providers.mock.adapter import MockMCPAdapter
from oss.src.core.gateways.mcps.providers.mock.issuer import build_oauth_router
from oss.src.core.gateways.mcps.types import MCPUpstreamError
from oss.src.utils.env import env

_INTERNAL_ERROR = -32603  # JSON-RPC 2.0

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

    return await _serve(request)


async def _serve(request: Request) -> Response:
    """Answer one JSON-RPC request through the shared adapter.

    Split out of `relay` so the OAuth-protected surface (`issuer.MCP_PATH`) answers with
    the same bytes once its bearer is accepted, rather than with a second implementation
    of the same protocol.
    """
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
        # The adapter answers an unknown method with a JSON-RPC error rather than raising, so
        # this is a genuine transport failure. It still speaks JSON-RPC, because a client that
        # reached this tier over a socket must not have to parse a different shape than the
        # in-process tier sends. A bare `text/plain` string here was that divergence.
        return JSONResponse(
            status_code=exc.status_code or 502,
            content={
                "jsonrpc": "2.0",
                "id": payload.get("id"),
                "error": {"code": _INTERNAL_ERROR, "message": exc.message},
            },
        )

    if result.status_code == 202:
        return Response(status_code=202, headers={"X-Agenta-Mock-Profile": profile})

    # The adapter decides the media type (some methods answer as an SSE event), and this tier
    # must not relabel it: a client is debugged against one tier and trusted against the other.
    return Response(
        status_code=result.status_code,
        content=result.body,
        media_type=result.headers.get("content-type", "application/json"),
        headers={"X-Agenta-Mock-Profile": profile},
    )


# The header-authenticated MCP surface.
#
# The third thing an MCP server can want, and the one no mock could express. `/` is open,
# `/oauth/mcp` publishes OAuth metadata, and the bearer profile on `/` is selected by an
# `X-Agenta-Mock-Profile` request header that only a test sends. So a person driving a
# browser had no address that answers the way a key-authenticated server answers, and the
# connect journey's API-key screen — which the probe reaches by reporting `unknown` for a
# 401 that names no OAuth metadata — could not be reached by hand at all.
#
# Deliberately publishing NO protected-resource document and NO `resource_metadata` in the
# challenge: that absence is the whole signal. A 401 that names one is the OAuth path, and
# this surface exists to be the other one.
KEY_MCP_PATH = "/key/mcp"

KEY_REALM = "agenta-mock-mcp-key"


def _key_challenge() -> Response:
    """The 401 a server that wants a header answers with.

    `Bearer` names a scheme and nothing else. RFC 9728 s5.1 is what turns a challenge into
    an OAuth start, and it does that through `resource_metadata`, which is absent here.
    """
    return JSONResponse(
        status_code=401,
        content={
            "error": "invalid_token",
            "error_description": (
                f"send the API key in the {env.mock_gateways.mcp_key_header} header"
            ),
        },
        headers={"WWW-Authenticate": f'Bearer realm="{KEY_REALM}"'},
    )


def _key_accepted(request: Request) -> bool:
    """Both forms the gateway sends an API key in.

    An endpoint that registers a `credential_header` sends the stored value verbatim under
    that name; one that registers none falls back to `Authorization: Bearer <value>`
    (`providers/http/adapter.py::_credential_headers`). A mock that took only one of them
    would refuse a correctly configured connection for a reason that is not the product.
    """
    expected = env.mock_gateways.mcp_key_value
    if not expected:
        return False
    if request.headers.get(env.mock_gateways.mcp_key_header) == expected:
        return True
    return request.headers.get("Authorization") == f"Bearer {expected}"


def build_key_router() -> APIRouter:
    """The header-authenticated surface, as a router so it is testable without the flag."""
    router = APIRouter()

    @router.get(KEY_MCP_PATH)
    async def challenge_on_probe() -> Response:
        """`/` answers 405 to a GET, which tells a client nothing. This one challenges,
        the way the OAuth surface does, so a GET and a POST agree about what is wanted."""
        return _key_challenge()

    @router.post(KEY_MCP_PATH)
    async def key_relay(request: Request) -> Response:
        if not _key_accepted(request):
            return _key_challenge()
        # The same handler `/` and `/oauth/mcp` use, so all three answer one request with
        # one set of bytes and the framing rules stay in one place.
        return await _serve(request)

    return router


@app.get("/")
async def reject_get() -> Response:
    return Response(status_code=405)


@app.delete("/")
async def reject_delete() -> Response:
    return Response(status_code=405)


# The OAuth issuer and the MCP surface it protects, behind the same operator switch the
# mock adapters are registered behind in `api/entrypoints/routers.py`. With the flag off
# the routes do not exist at all, so a process that is not a development mock cannot serve
# an authorization server by accident.
if env.mock_gateways.enabled:
    app.include_router(build_oauth_router(relay=_serve))
    app.include_router(build_key_router())
