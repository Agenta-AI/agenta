"""MockMCPAdapter: the in-process mock MCP upstream (entities.md §7.1, D23).

Unlike the real `http`/`composio` adapters, this one *is* the upstream — it
parses `body` (the caller's JSON-RPC payload) itself and answers in-process,
because there is nothing behind it to relay to. This does not violate D16's
transparency rule: D16 constrains the gateway, which still passes `body`
through this port untouched; a mock *server* interpreting its own JSON-RPC
input is exactly what any real MCP server does.

Three tools, advertised by `tools/list` and dispatched by `tools/call`'s
`params.name`:

    echo    echoes params.arguments back as the tool result content
    fail    a JSON-RPC *result* carrying isError: true — never raised. A
            tool's own business failure is not a transport failure (D16,
            api/AGENTS.md's pass-through rule).
    slow    sleeps params.arguments.seconds (default 5), then a fixed result

`notifications/*` returns 202 with an empty body, matching the runner's
internal MCP server (services/runner/src/tools/tool-mcp-http.ts). Any other
method is a transport-level failure: MCPUpstreamError(status_code=501) — there
is no fourth method to mock.

Forced scope challenges (MCPScopeInsufficientError) are explicitly not built
here (D23's "later"): that type is unreachable until the OAuth checkpoint
(wave 3); adding a tool that raises it now would exercise a 403-handling path
that does not exist yet. Extension point: a `scope-challenge` tool would live
in _TOOLS + _dispatch_tool_call once that checkpoint lands.
"""

import asyncio
import json
from typing import Any, Dict

from oss.src.core.gateways.mcps.dtos import (
    MCPCallContext,
    MCPRelayAuth,
    MCPResolvedRoute,
)
from oss.src.core.gateways.mcps.interfaces import MCPRelayResult, MCPUpstreamInterface
from oss.src.core.gateways.mcps.types import MCPUpstreamError

_PROTOCOL_VERSION = "2026-07-28"  # pinned per MCPCallContext's own docstring

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


def _tool_result(text: str, *, is_error: bool = False) -> Dict[str, Any]:
    return {"content": [{"type": "text", "text": text}], "isError": is_error}


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


def _initialize_result() -> Dict[str, Any]:
    return {
        "protocolVersion": _PROTOCOL_VERSION,
        "serverInfo": {"name": "agenta-mock-mcp", "version": "0.1.0"},
        "capabilities": {"tools": {}},
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

        if method.startswith("notifications/"):
            return MCPRelayResult(status_code=202, headers={}, body=b"")

        if method == "initialize":
            result = _initialize_result()
        elif method == "tools/list":
            result = {"tools": _TOOLS}
        elif method == "tools/call":
            result = await _dispatch_tool_call(payload.get("params") or {})
        else:
            raise MCPUpstreamError(
                target=route.url,
                status_code=501,
                detail=f"unsupported method: {method}",
            )

        response = {"jsonrpc": "2.0", "id": request_id, "result": result}
        return MCPRelayResult(
            status_code=200,
            headers={"content-type": "application/json"},
            body=json.dumps(response).encode(),
        )
