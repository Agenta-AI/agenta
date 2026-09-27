"""A remote MCP server, reached through the gateway's MCP upstream adapters.

`HttpMCPAdapter` is a raw relay, so this provider holds the little MCP client a tool call
needs: `initialize`, `notifications/initialized`, then one `tools/call` carrying the
negotiated protocol version and any session id. Everything before the `tools/call` is free,
so a failure there is "not sent"; the `tools/call` itself is sent exactly once.
"""

import json
from typing import Any, Dict, Optional

import httpx

from oss.src.core.gateways.mcps.dtos import (
    MCPCallContext,
    MCPDirectAuth,
    MCPResolvedRoute,
)
from oss.src.core.gateways.mcps.interfaces import MCPRelayResult, MCPUpstreamInterface
from oss.src.core.gateways.mcps.types import MCPUpstreamError
from oss.src.core.managed_tools.dtos import (
    ManagedActionContext,
    ManagedActionRateLimit,
    ManagedActionResponse,
    ManagedActionUpstreamFailure,
)
from oss.src.core.managed_tools.interfaces import ManagedActionProviderInterface
from oss.src.core.managed_tools.types import ManagedActionNotSentError

_OFFERED_PROTOCOL_VERSION = "2025-06-18"
_CLIENT_INFO = {"name": "agenta-managed-tools", "version": "0.1.0"}
_ACCEPT = "application/json, text/event-stream"
_DETAIL_LIMIT = 300


class _NotAnswered(Exception):
    pass


class MCPActionProvider(ManagedActionProviderInterface):
    def __init__(
        self,
        *,
        name: str,
        upstream: MCPUpstreamInterface,
        route: MCPResolvedRoute,
        auth: MCPDirectAuth,
        rate_limit: Optional[ManagedActionRateLimit] = None,
    ) -> None:
        self.name = name
        self.rate_limit = rate_limit
        self._upstream = upstream
        self._route = route
        self._auth = auth

    async def invoke(
        self,
        *,
        operation: str,
        arguments: Dict[str, Any],
        context: ManagedActionContext,
    ) -> ManagedActionResponse:
        try:
            headers = await self._handshake()
        except (MCPUpstreamError, _NotAnswered) as exc:
            raise ManagedActionNotSentError(f"MCP handshake failed: {exc}") from exc

        try:
            result = await self._send(
                method="tools/call",
                request_id=2,
                params={"name": operation, "arguments": arguments},
                headers=headers,
            )
        except MCPUpstreamError as exc:
            if isinstance(exc.__cause__, (httpx.ConnectError, httpx.ConnectTimeout)):
                raise ManagedActionNotSentError(str(exc)) from exc
            raise

        if result.status_code == 429:
            return ManagedActionResponse(
                failure=ManagedActionUpstreamFailure(
                    kind="rate_limited", message="the MCP server is rate limiting"
                )
            )
        if result.status_code in (401, 403):
            return ManagedActionResponse(
                failure=ManagedActionUpstreamFailure(
                    kind="auth_failed", message=f"HTTP {result.status_code}"
                )
            )
        message = _message(result, request_id=2)
        if message is None or "error" in message:
            detail = (message or {}).get("error") or result.body[:_DETAIL_LIMIT]
            return ManagedActionResponse(
                failure=ManagedActionUpstreamFailure(
                    kind="rejected", message=str(detail)[:_DETAIL_LIMIT]
                )
            )
        return _tool_response(message.get("result") or {})

    async def _handshake(self) -> Dict[str, str]:
        result = await self._send(
            method="initialize",
            request_id=1,
            params={
                "protocolVersion": _OFFERED_PROTOCOL_VERSION,
                "capabilities": {},
                "clientInfo": _CLIENT_INFO,
            },
            headers={},
        )
        message = _message(result, request_id=1)
        version = ((message or {}).get("result") or {}).get("protocolVersion")
        if result.status_code != 200 or not isinstance(version, str):
            raise _NotAnswered(f"initialize answered HTTP {result.status_code}")
        # Every request after the handshake carries the version the server answered with,
        # not the one we offered.
        headers = {"mcp-protocol-version": version}
        session = next(
            (v for k, v in result.headers.items() if k.lower() == "mcp-session-id"),
            None,
        )
        if session:
            headers["mcp-session-id"] = session
        await self._upstream.relay(
            route=self._route,
            auth=self._auth,
            context=MCPCallContext(method="notifications/initialized"),
            body=json.dumps(
                {"jsonrpc": "2.0", "method": "notifications/initialized"}
            ).encode(),
            headers={**headers, "accept": _ACCEPT},
        )
        return headers

    async def _send(
        self,
        *,
        method: str,
        request_id: int,
        params: Dict[str, Any],
        headers: Dict[str, str],
    ) -> MCPRelayResult:
        return await self._upstream.relay(
            route=self._route,
            auth=self._auth,
            context=MCPCallContext(method=method, target=params.get("name")),
            body=json.dumps(
                {"jsonrpc": "2.0", "id": request_id, "method": method, "params": params}
            ).encode(),
            headers={**headers, "accept": _ACCEPT, "content-type": "application/json"},
        )


def _message(result: MCPRelayResult, *, request_id: int) -> Optional[Dict[str, Any]]:
    """The JSON-RPC message answering `request_id`, from a JSON or an event-stream body.
    A stream may carry notifications before the answer."""
    content_type = next(
        (v for k, v in result.headers.items() if k.lower() == "content-type"), ""
    )
    try:
        text = result.body.decode()
    except UnicodeDecodeError:
        return None
    if "text/event-stream" in content_type:
        candidates = [
            line[len("data:") :].strip()
            for line in text.splitlines()
            if line.startswith("data:")
        ]
    else:
        candidates = [text]
    for candidate in candidates:
        try:
            message = json.loads(candidate)
        except json.JSONDecodeError:
            continue
        if isinstance(message, dict) and message.get("id") == request_id:
            return message
    return None


def _tool_response(result: Dict[str, Any]) -> ManagedActionResponse:
    text = " ".join(
        part.get("text", "")
        for part in result.get("content") or []
        if isinstance(part, dict) and part.get("type") == "text"
    )
    if result.get("isError"):
        return ManagedActionResponse(
            failure=ManagedActionUpstreamFailure(
                kind="rejected", message=text[:_DETAIL_LIMIT] or "the tool failed"
            )
        )
    structured = result.get("structuredContent")
    if not isinstance(structured, dict):
        try:
            structured = json.loads(text)
        except json.JSONDecodeError:
            structured = None
    if not isinstance(structured, dict):
        return ManagedActionResponse(
            failure=ManagedActionUpstreamFailure(
                kind="rejected", message="the tool's answer is not a JSON object"
            )
        )
    return ManagedActionResponse(output=structured)
