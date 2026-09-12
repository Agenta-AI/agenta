"""Expose already-resolved callback tools as a Streamable HTTP MCP server."""

import json
from typing import Any, Dict, List

from fastapi import HTTPException, Request

from oss.src.core.gateways.mcps.interfaces import MCPRelayResult
from oss.src.core.tools.dtos import ToolCall


class AgentaMCPAdapter:
    """Bridge one scoped gateway credential to the existing ``/tools/call`` seam."""

    def __init__(self, *, tools_router: Any) -> None:
        self.tools_router = tools_router

    @staticmethod
    def _tools(request: Request) -> List[Dict[str, Any]]:
        run_id = getattr(request.state, "gateway_run_id", None)
        tools = getattr(request.state, "gateway_tools", None)
        if not isinstance(run_id, str) or not run_id or not isinstance(tools, list):
            raise ValueError("Agenta MCP requires a scoped invocation credential")
        valid = [
            item
            for item in tools
            if isinstance(item, dict)
            and isinstance(item.get("name"), str)
            and isinstance(item.get("call_ref"), str)
        ]
        if len(valid) != len(tools):
            raise ValueError("Agenta MCP credential has invalid tool descriptors")
        return valid

    async def relay(self, *, request: Request, body: bytes) -> MCPRelayResult:
        try:
            payload = json.loads(body)
        except (json.JSONDecodeError, UnicodeDecodeError) as exc:
            raise ValueError("MCP request body must be valid JSON-RPC") from exc
        if not isinstance(payload, dict):
            raise ValueError("MCP request body must be a JSON object")

        method = payload.get("method")
        request_id = payload.get("id")
        tools = self._tools(request)
        if method == "tools/list":
            result = {
                "tools": [
                    {
                        "name": item["name"],
                        "description": item.get("description") or item["name"],
                        "inputSchema": item.get("input_schema") or {},
                    }
                    for item in tools
                ]
            }
            return self._response(request_id=request_id, result=result)

        if method != "tools/call":
            raise ValueError("Agenta MCP supports only tools/list and tools/call")
        params = payload.get("params")
        if not isinstance(params, dict):
            raise ValueError("tools/call requires object params")
        name = params.get("name")
        selected = next((item for item in tools if item["name"] == name), None)
        if selected is None:
            raise ValueError("Tool is not available for this invocation")
        arguments = params.get("arguments", {})
        if not isinstance(arguments, dict):
            raise ValueError("tools/call arguments must be an object")

        try:
            response = await self.tools_router.call_tool(
                request=request,
                body=ToolCall.model_validate(
                    {
                        "data": {
                            "id": str(request_id) if request_id is not None else "mcp",
                            "function": {
                                "name": selected["call_ref"],
                                "arguments": arguments,
                            },
                        }
                    }
                ),
            )
        except HTTPException as exc:
            raise ValueError(str(exc.detail)) from exc

        content = (
            response.call.data.content if response.call and response.call.data else ""
        )
        return self._response(
            request_id=request_id,
            result={"content": [{"type": "text", "text": content}]},
        )

    @staticmethod
    def _response(*, request_id: Any, result: Dict[str, Any]) -> MCPRelayResult:
        return MCPRelayResult(
            status_code=200,
            headers={"content-type": "application/json"},
            body=json.dumps(
                {"jsonrpc": "2.0", "id": request_id, "result": result}
            ).encode(),
        )
