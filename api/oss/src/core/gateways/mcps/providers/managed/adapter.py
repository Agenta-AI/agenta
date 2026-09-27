"""Expose the managed tool actions as a Streamable HTTP MCP server.

JSON-RPC in, executor calls out, nothing else: listing, admission, dispatch and billing
belong to `ManagedToolsService`. The trusted context arrives from the relay, built from the
authenticated scope and the signed gateway credential, and is never read from the body.
"""

import json
from typing import Any, Dict, Optional

from oss.src.core.gateways.mcps.interfaces import MCPRelayResult
from oss.src.core.managed_tools.dtos import (
    ManagedAction,
    ManagedActionContext,
    ManagedActionPrice,
    ManagedActionUnit,
)
from oss.src.core.managed_tools.service import ManagedToolsService
from oss.src.core.managed_tools.types import ManagedActionNotFoundError

_PROTOCOL_VERSION = "2025-06-18"
_SERVER_INFO = {"name": "agenta-managed-tools", "version": "0.1.0"}
_INVALID_REQUEST = -32600
_METHOD_NOT_FOUND = -32601
_INVALID_PARAMS = -32602
_UNIT_NAMES = {ManagedActionUnit.CALLS: "call", ManagedActionUnit.RESULTS: "result"}


class ManagedMCPAdapter:
    def __init__(self, *, managed_tools: ManagedToolsService) -> None:
        self.managed_tools = managed_tools

    async def relay(
        self, *, context: ManagedActionContext, body: bytes
    ) -> MCPRelayResult:
        try:
            payload = json.loads(body)
        except (json.JSONDecodeError, UnicodeDecodeError):
            payload = None
        if not isinstance(payload, dict):
            return _error(None, _INVALID_REQUEST, "The body must be a JSON-RPC object.")

        method = payload.get("method")
        request_id = payload.get("id")
        params = (
            payload.get("params") if isinstance(payload.get("params"), dict) else {}
        )

        # A request with no id is a notification, and answering one breaks the protocol.
        if request_id is None:
            return MCPRelayResult(status_code=202, headers={}, body=b"")

        if method == "initialize":
            requested = params.get("protocolVersion")
            return _result(
                request_id,
                {
                    "protocolVersion": (
                        requested
                        if isinstance(requested, str) and requested
                        else _PROTOCOL_VERSION
                    ),
                    "capabilities": {"tools": {}},
                    "serverInfo": _SERVER_INFO,
                },
            )
        if method == "ping":
            return _result(request_id, {})
        if method == "tools/list":
            actions = await self.managed_tools.list_actions()
            return _result(
                request_id,
                {"tools": [_tool(action, price) for action, price in actions]},
            )
        if method != "tools/call":
            return _error(request_id, _METHOD_NOT_FOUND, f"method not found: {method}")

        name = params.get("name")
        arguments = params.get("arguments", {})
        if not isinstance(name, str) or not isinstance(arguments, dict):
            return _error(
                request_id,
                _INVALID_PARAMS,
                "tools/call needs a name and object arguments",
            )
        try:
            result = await self.managed_tools.execute(
                context=context, tool=name, arguments=arguments
            )
        except ManagedActionNotFoundError:
            return _error(request_id, _INVALID_PARAMS, f"unknown tool: {name}")

        if result.error is not None:
            envelope = {"error": result.error.model_dump(exclude_none=True)}
            return _result(
                request_id,
                {
                    "content": [{"type": "text", "text": json.dumps(envelope)}],
                    "structuredContent": envelope,
                    "isError": True,
                },
            )
        return _result(
            request_id,
            {
                "content": [{"type": "text", "text": json.dumps(result.output)}],
                "structuredContent": result.output,
                "isError": False,
            },
        )


def _tool(action: ManagedAction, price: Optional[ManagedActionPrice]) -> Dict[str, Any]:
    tool: Dict[str, Any] = {
        "name": action.tool,
        "description": action.description,
        "inputSchema": action.input_model.model_json_schema(),
        "outputSchema": action.output_model.model_json_schema(),
        "annotations": {"readOnlyHint": action.read_only},
    }
    if price is not None:
        tool["description"] = f"{action.description} {_price_sentence(price)}"
        tool["_meta"] = {"agenta/price": price.model_dump(mode="json")}
    return tool


def _price_sentence(price: ManagedActionPrice) -> str:
    unit = _UNIT_NAMES[price.unit]
    dollars = price.musd_per_unit / 1_000_000
    sentence = f"Costs ${dollars:g} per {unit}"
    if price.unit == ManagedActionUnit.CALLS:
        return f"{sentence}, charged only when it succeeds."
    return f"{sentence} returned, at most {price.max_units_per_call} charged per call."


def _result(request_id: Any, result: Dict[str, Any]) -> MCPRelayResult:
    return _respond({"jsonrpc": "2.0", "id": request_id, "result": result})


def _error(request_id: Any, code: int, message: str) -> MCPRelayResult:
    return _respond(
        {
            "jsonrpc": "2.0",
            "id": request_id,
            "error": {"code": code, "message": message},
        }
    )


def _respond(message: Dict[str, Any]) -> MCPRelayResult:
    return MCPRelayResult(
        status_code=200,
        headers={"content-type": "application/json"},
        body=json.dumps(message).encode(),
    )
