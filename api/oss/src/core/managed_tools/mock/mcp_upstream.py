"""The mock MCP upstream for `mock.search_companies`: an in-process
`MCPUpstreamInterface`, as strict about the handshake as a real server.

Not the shared mock MCP server: other suites pin that server's exact tool list, and an
agent on "Mock Tools" would see a free twin of a paid action.
"""

import json
from hashlib import sha256
from typing import Any, Dict

from oss.src.core.gateways.mcps.dtos import (
    MCPCallContext,
    MCPRelayAuth,
    MCPResolvedRoute,
)
from oss.src.core.gateways.mcps.interfaces import MCPRelayResult, MCPUpstreamInterface

MOCK_MCP_URL = "http://mock-managed-mcp.invalid/mcp"
_PROTOCOL_VERSION = "2025-03-26"
_SESSION = "mock-managed-session"
_INDUSTRIES = ("software", "logistics", "health", "finance", None)


def search_companies(query: str, limit: int) -> Dict[str, Any]:
    seed = int(sha256(query.encode()).hexdigest(), 16)
    stem = "".join(ch for ch in query.lower() if ch.isalnum())[:12] or "company"
    return {
        "companies": [
            {
                "name": f"{stem.capitalize()} {index + 1}",
                "domain": f"{stem}{index + 1}.example",
                "employees": 10 + (seed >> index) % 5000,
                "industry": _INDUSTRIES[(seed + index) % len(_INDUSTRIES)],
            }
            for index in range(limit)
        ]
    }


def _json(message: Dict[str, Any]) -> MCPRelayResult:
    return MCPRelayResult(
        status_code=200,
        headers={"content-type": "application/json", "mcp-session-id": _SESSION},
        body=json.dumps(message).encode(),
    )


def _event_stream(message: Dict[str, Any]) -> MCPRelayResult:
    # A notification before the answer, as a real server may send.
    notice = {"jsonrpc": "2.0", "method": "notifications/message", "params": {}}
    body = (
        f"event: message\ndata: {json.dumps(notice)}\n\n"
        f"event: message\ndata: {json.dumps(message)}\n\n"
    )
    return MCPRelayResult(
        status_code=200,
        headers={"content-type": "text/event-stream"},
        body=body.encode(),
    )


class MockManagedMCPUpstream(MCPUpstreamInterface):
    async def relay(
        self,
        *,
        route: MCPResolvedRoute,
        auth: MCPRelayAuth,
        context: MCPCallContext,
        body: bytes,
        headers: Dict[str, str],
    ) -> MCPRelayResult:
        payload = json.loads(body)
        method, request_id = payload.get("method"), payload.get("id")
        lowered = {key.lower(): value for key, value in headers.items()}
        if method == "initialize":
            return _json(
                {
                    "jsonrpc": "2.0",
                    "id": request_id,
                    "result": {
                        "protocolVersion": _PROTOCOL_VERSION,
                        "capabilities": {"tools": {}},
                        "serverInfo": {"name": "mock-managed-mcp", "version": "0.1.0"},
                    },
                }
            )
        if (
            lowered.get("mcp-protocol-version") != _PROTOCOL_VERSION
            or lowered.get("mcp-session-id") != _SESSION
        ):
            return MCPRelayResult(status_code=400, headers={}, body=b"bad session")
        if request_id is None:
            return MCPRelayResult(status_code=202, headers={}, body=b"")
        params = payload.get("params") or {}
        if method != "tools/call" or params.get("name") != "search_companies":
            return _json(
                {
                    "jsonrpc": "2.0",
                    "id": request_id,
                    "error": {"code": -32601, "message": "unknown method or tool"},
                }
            )
        arguments = params.get("arguments") or {}
        found = search_companies(
            str(arguments.get("query") or ""), int(arguments["limit"])
        )
        return _event_stream(
            {
                "jsonrpc": "2.0",
                "id": request_id,
                "result": {
                    "content": [{"type": "text", "text": json.dumps(found)}],
                    "structuredContent": found,
                    "isError": False,
                },
            }
        )
