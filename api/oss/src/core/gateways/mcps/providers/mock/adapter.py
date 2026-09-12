"""In-process mock MCP upstream.

Unlike the real `http`/`composio` adapters, this one *is* the upstream — it
parses `body` (the caller's JSON-RPC payload) itself and answers in-process,
because there is nothing behind it to relay to. The gateway still passes `body`
through this port untouched; a mock server interpreting its own JSON-RPC
input is exactly what any real MCP server does.

Three tools, advertised by `tools/list` and dispatched by `tools/call`'s
`params.name`:

    echo    echoes params.arguments back as the tool result content
    fail    a JSON-RPC *result* carrying isError: true — never raised. A
            tool's own business failure is not a transport failure.
    slow    sleeps params.arguments.seconds (default 5), then a fixed result

Beyond the tools it answers the protocol's opening exchange — `initialize`, any
notification, and `ping` — because a spec-compliant MCP client sends `initialize`
first and cannot reach `tools/list` until it is answered. A mock that refused it
was usable only by a client that skips the handshake.

The conventions here are the runner's own MCP tool server's
(`services/runner/src/tools/tool-mcp-http.ts`), deliberately: a request with no
`id` is a notification and gets `202` and no body, `initialize` echoes the
client's `protocolVersion`, and an unknown method is JSON-RPC error `-32601` at
HTTP 200, never a transport failure. Two mock servers answering the same protocol
differently is a trap for whoever debugs against them.
"""

import asyncio
import json
from typing import Any, Dict

import httpx

from oss.src.core.gateways.mcps.dtos import (
    MCPCallContext,
    MCPDirectAuth,
    MCPRelayAuth,
    MCPResolvedRoute,
)
from oss.src.core.gateways.mcps.interfaces import MCPRelayResult, MCPUpstreamInterface
from oss.src.core.gateways.mcps.types import MCPUpstreamError
from oss.src.core.gateways.policy.dtos import ResolvedSecret
from oss.src.core.secrets.enums import SecretKind
from oss.src.utils.env import env

_PROTOCOL_VERSION = "2026-07-28"  # pinned per MCPCallContext's own docstring
_METHOD_NOT_FOUND = -32601  # JSON-RPC 2.0
_CACHE_TTL_MS = 300_000
_SERVER_INFO = {"name": "agenta-mock-mcp", "version": "0.1.0"}

_TOOLS = [
    {
        "name": "echo",
        "description": "Echoes the given arguments back as the tool result.",
        "inputSchema": {"type": "object", "additionalProperties": True},
    },
    {
        "name": "fail",
        "description": "Always returns a tool-level error result (isError: true).",
        "inputSchema": {"type": "object", "additionalProperties": True},
    },
    {
        "name": "slow",
        "description": "Sleeps `seconds` (default 5) before returning a fixed result.",
        "inputSchema": {
            "type": "object",
            "properties": {"seconds": {"type": "integer"}},
        },
    },
]


def _relay_result(response: Dict[str, Any]) -> MCPRelayResult:
    """One JSON-RPC response out, so both mock tiers emit byte-identical bodies."""
    return MCPRelayResult(
        status_code=200,
        headers={"content-type": "application/json"},
        body=json.dumps(response).encode(),
    )


def _tool_result(text: str, *, is_error: bool = False) -> Dict[str, Any]:
    return {
        "resultType": "complete",
        "content": [{"type": "text", "text": text}],
        "isError": is_error,
        "_meta": {"io.modelcontextprotocol/serverInfo": _SERVER_INFO},
    }


async def _dispatch_tool_call(params: Dict[str, Any]) -> Dict[str, Any]:
    name = params.get("name")
    arguments = params.get("arguments") or {}

    if name == "echo":
        return _tool_result(json.dumps(arguments), is_error=False)

    if name == "fail":
        return _tool_result("mock/fail: forced tool failure", is_error=True)

    if name == "slow":
        seconds = arguments.get("seconds", 5)
        await asyncio.sleep(seconds)
        return _tool_result(f"slept {seconds}s", is_error=False)

    return _tool_result(f"unknown tool: {name}", is_error=True)


def _initialize_result(params: Dict[str, Any]) -> Dict[str, Any]:
    """The handshake answer, with the client's own protocol version echoed back.

    A mock accepts whatever version the client opens with. Pinning ours here would make the
    mock reject clients by version, which is a real server's job and never a fixture's.
    """
    requested = params.get("protocolVersion")
    return {
        "protocolVersion": (
            requested if isinstance(requested, str) and requested else _PROTOCOL_VERSION
        ),
        "capabilities": {"tools": {}},
        "serverInfo": _SERVER_INFO,
    }


def _discovery_result() -> Dict[str, Any]:
    return {
        "resultType": "complete",
        "supportedVersions": [_PROTOCOL_VERSION],
        "capabilities": {"tools": {}},
        "_meta": {"io.modelcontextprotocol/serverInfo": _SERVER_INFO},
        "ttlMs": _CACHE_TTL_MS,
        "cacheScope": "public",
    }


def _tools_list_result() -> Dict[str, Any]:
    return {
        "resultType": "complete",
        "tools": _TOOLS,
        "ttlMs": _CACHE_TTL_MS,
        "cacheScope": "public",
        "_meta": {"io.modelcontextprotocol/serverInfo": _SERVER_INFO},
    }


class MockMCPAdapter(MCPUpstreamInterface):
    async def relay(
        self,
        *,
        route: MCPResolvedRoute,
        auth: MCPRelayAuth,
        #
        context: MCPCallContext,
        body: bytes,
        headers: Dict[str, str],
    ) -> MCPRelayResult:
        try:
            payload = json.loads(body) if body else {}
        except (json.JSONDecodeError, TypeError):
            payload = {}

        method = payload.get("method") or context.method or ""
        request_id = payload.get("id")

        # A JSON-RPC request with no id is a notification, and answering one is itself a
        # protocol violation. `notifications/initialized` is the second call of every
        # handshake, so this branch is on the happy path, not an edge case.
        if request_id is None:
            return MCPRelayResult(status_code=202, headers={}, body=b"")

        if method == "initialize":
            result = _initialize_result(payload.get("params") or {})
        elif method == "ping":
            result = {}
        elif method == "server/discover":
            result = _discovery_result()
        elif method == "tools/list":
            result = _tools_list_result()
        elif method == "tools/call":
            result = await _dispatch_tool_call(payload.get("params") or {})
        else:
            # An unknown method is the server answering, not the transport failing, so it is
            # a JSON-RPC error at HTTP 200. Raising here made the two tiers disagree: the
            # in-process route answered 502 with a text detail while the socket route answered
            # 501 with a bare string, so a client could not read one shape from either.
            return _relay_result(
                {
                    "jsonrpc": "2.0",
                    "id": request_id,
                    "error": {
                        "code": _METHOD_NOT_FOUND,
                        "message": f"method not found: {method}",
                    },
                }
            )

        return _relay_result({"jsonrpc": "2.0", "id": request_id, "result": result})


def _secret_key(secret: ResolvedSecret | None) -> str | None:
    if secret is None:
        return None
    if secret.secret.kind in (SecretKind.PROVIDER_KEY, SecretKind.CUSTOM_PROVIDER):
        return secret.secret.data.provider.key
    if secret.secret.kind == SecretKind.CUSTOM_SECRET:
        content = secret.secret.data.secret.content
        return content if isinstance(content, str) else None
    return None


class DeployableMockMCPAdapter(MCPUpstreamInterface):
    """Relay generated development entries to the compose mock over a real socket.

    This bypasses the generic custom-server SSRF adapter because the target is a
    fixed, opt-in development service, not caller-controlled routing data.
    """

    async def relay(
        self,
        *,
        route: MCPResolvedRoute,
        auth: MCPRelayAuth,
        context: MCPCallContext,
        body: bytes,
        headers: Dict[str, str],
    ) -> MCPRelayResult:
        if not env.mock_gateways.enabled or route.url.rstrip(
            "/"
        ) != env.mock_gateways.mcp_url.rstrip("/"):
            raise MCPUpstreamError(
                target=route.url, detail="mock gateway is unavailable"
            )

        outbound = {
            key: value
            for key, value in {**route.headers, **headers}.items()
            if key.lower() not in {"authorization", "host", "content-length"}
        }
        token = (
            _secret_key(auth.secret)
            if isinstance(auth, MCPDirectAuth)
            else env.mock_gateways.upstream_token
        )
        if token is None:
            token = env.mock_gateways.upstream_token
        if token:
            outbound["Authorization"] = f"Bearer {token}"

        try:
            async with httpx.AsyncClient(
                timeout=route.settings.timeout_seconds or 30.0
            ) as client:
                response = await client.post(route.url, content=body, headers=outbound)
        except httpx.HTTPError as exc:
            raise MCPUpstreamError(
                target=route.url, detail="mock gateway request failed"
            ) from exc

        return MCPRelayResult(
            status_code=response.status_code,
            headers=dict(response.headers),
            body=response.content,
        )
