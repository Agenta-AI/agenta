"""Expose a stored plugin's operations through the workflow child-run dispatcher."""

import json
from typing import Any
from uuid import UUID

from fastapi import Request

from oss.src.core.gateways.dtos import GatewayEndpointNamespace
from oss.src.core.gateways.mcps.interfaces import MCPRelayResult
from oss.src.core.gateways.mcps.types import MCPEndpointNotFoundError
from oss.src.core.shared.dtos import Reference
from oss.src.core.tools.dtos import ToolCall
from oss.src.core.workflows.dtos import WorkflowRevision


class PluginMCPAdapter:
    def __init__(self, *, workflows_service: Any, tools_router: Any) -> None:
        self.workflows_service = workflows_service
        self.tools_router = tools_router

    async def _revision(self, *, project_id: UUID, slug: str) -> WorkflowRevision:
        revision, _, _ = await self.workflows_service.retrieve_workflow_revision(
            project_id=project_id,
            workflow_ref=Reference(slug=slug),
            include_archived=False,
        )
        if revision is None or not revision.flags or not revision.flags.is_plugin:
            raise MCPEndpointNotFoundError(
                namespace=GatewayEndpointNamespace.BUILTIN, name=slug
            )
        return revision

    @staticmethod
    def _response(
        request_id: Any, *, result: Any = None, error: Any = None
    ) -> MCPRelayResult:
        payload = {"jsonrpc": "2.0", "id": request_id}
        payload["error" if error is not None else "result"] = (
            error if error is not None else result
        )
        return MCPRelayResult(
            status_code=200,
            headers={"content-type": "application/json"},
            body=json.dumps(payload).encode(),
        )

    async def relay(
        self, *, request: Request, project_id: UUID, slug: str, body: bytes
    ) -> MCPRelayResult:
        try:
            payload = json.loads(body)
        except (ValueError, UnicodeDecodeError):
            return self._response(
                None, error={"code": -32700, "message": "Parse error"}
            )
        if not isinstance(payload, dict):
            return self._response(
                None, error={"code": -32600, "message": "Invalid request"}
            )
        request_id = payload.get("id")
        revision = await self._revision(project_id=project_id, slug=slug)
        if request_id is None:
            return MCPRelayResult(status_code=202, headers={}, body=b"")
        method = payload.get("method")
        params = payload.get("params") or {}
        if not isinstance(params, dict):
            return self._response(
                request_id,
                error={"code": -32602, "message": "params must be an object"},
            )
        if method == "initialize":
            return self._response(
                request_id,
                result={
                    "protocolVersion": params.get("protocolVersion") or "2025-06-18",
                    "capabilities": {"tools": {}},
                    "serverInfo": {"name": "agenta-plugin", "version": "0.1.0"},
                },
            )
        operations = ((revision.data.parameters or {}).get("plugin") or {}).get(
            "operations"
        ) or []
        if method == "tools/list":
            return self._response(
                request_id,
                result={
                    "tools": [
                        {
                            "name": op["name"],
                            "description": op.get("description") or op["name"],
                            "inputSchema": op.get("input_schema") or {"type": "object"},
                        }
                        for op in operations
                    ]
                },
            )
        if method != "tools/call":
            return self._response(
                request_id, error={"code": -32601, "message": "Method not found"}
            )
        name = params.get("name")
        args = params.get("arguments", {})
        if not any(op["name"] == name for op in operations) or not isinstance(
            args, dict
        ):
            return self._response(
                request_id,
                error={
                    "code": -32602,
                    "message": "Unknown operation or invalid arguments",
                },
            )
        # Dispatch precisely the revision whose manifest was checked above.
        response = await self.tools_router.call_tool(
            request=request,
            body=ToolCall.model_validate(
                {
                    "data": {
                        "id": str(request_id),
                        "function": {
                            "name": f"workflow.variant.{slug}.{revision.version}",
                            "arguments": {"operation": name, "args": args},
                        },
                    }
                }
            ),
        )
        call = response.call
        failed = call is None or (
            call.status is not None and call.status.code == "STATUS_CODE_ERROR"
        )
        content = (
            call.data.content if call and call.data else "Plugin returned no result"
        )
        return self._response(
            request_id,
            result={"content": [{"type": "text", "text": content}], "isError": failed},
        )
