"""`McpGatewayProxy`: the MCP data plane's protocol surface (entities.md §9).

Three thin routes, one per namespace (D27); they exist because the routes carry different
path parameters, not because the behaviour differs. Each parses the caller's routing
headers, reads the raw body, and delegates to `McpGatewayService.relay` (WP9), which owns
target resolution, the allowlist check, credential resolution and the outbound guard. No
wire models here — the data plane relays bytes (§6).
"""

from __future__ import annotations

from typing import TYPE_CHECKING, Dict, Optional

from fastapi import APIRouter, HTTPException, Request, Response, status

from oss.src.apis.fastapi.gateways.exceptions import handle_gateway_exceptions
from oss.src.apis.fastapi.gateways.mcps.utils import parse_mcp_call_context
from oss.src.core.gateways.dtos import GatewayEndpointNamespace
from oss.src.utils.context import get_auth_scope
from oss.src.utils.exceptions import intercept_exceptions

if TYPE_CHECKING:
    from oss.src.core.gateways.mcps.service import McpGatewayService


def _forwarded_headers(request: Request) -> Dict[str, str]:
    """The caller's headers, stripped of Agenta's own gateway-token authorization —
    an upstream `custom` server must never see the platform secret that authenticated
    the caller to us (§7.1's pass-through rule stops at the body and status, not our
    own credentials)."""
    return {
        key: value
        for key, value in request.headers.items()
        if key.lower() != "authorization"
    }


class McpGatewayProxy:
    def __init__(self, *, mcp_gateway_service: "McpGatewayService") -> None:
        self.service = mcp_gateway_service
        self.router = APIRouter()

        self.router.add_api_route(
            "/agenta/{slug:path}",
            self.relay_agenta,
            methods=["POST"],
            operation_id="mcp_gateway_relay_agenta",
        )
        self.router.add_api_route(
            "/builtin/{provider}/{integration}/{connection}",
            self.relay_builtin,
            methods=["POST"],
            operation_id="mcp_gateway_relay_builtin",
        )
        self.router.add_api_route(
            "/custom/{slug}",
            self.relay_custom,
            methods=["POST"],
            operation_id="mcp_gateway_relay_custom",
        )

        for path in (
            "/agenta/{slug:path}",
            "/builtin/{provider}/{integration}/{connection}",
            "/custom/{slug}",
        ):
            self.router.add_api_route(
                path,
                self.reject_stream_verbs,
                methods=["GET", "DELETE"],
                include_in_schema=False,
            )

    async def _relay(
        self,
        *,
        request: Request,
        namespace: GatewayEndpointNamespace,
        name: str,
        provider: Optional[str] = None,
        integration: Optional[str] = None,
    ) -> Response:
        scope = get_auth_scope()
        headers = _forwarded_headers(request)

        try:
            context = parse_mcp_call_context(headers=headers)
        except ValueError as e:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=str(e),
            ) from e

        body = await request.body()

        result = await self.service.relay(
            scope=scope,
            namespace=namespace,
            name=name,
            provider=provider,
            integration=integration,
            #
            context=context,
            body=body,
            headers=headers,
        )

        return Response(
            content=result.body,
            status_code=result.status_code,
            headers=result.headers,
        )

    @intercept_exceptions()
    @handle_gateway_exceptions()
    async def relay_agenta(self, request: Request, slug: str) -> Response:
        return await self._relay(
            request=request,
            namespace=GatewayEndpointNamespace.AGENTA,
            name=slug,
        )

    @intercept_exceptions()
    @handle_gateway_exceptions()
    async def relay_builtin(
        self,
        request: Request,
        provider: str,
        integration: str,
        connection: str,
    ) -> Response:
        return await self._relay(
            request=request,
            namespace=GatewayEndpointNamespace.BUILTIN,
            name=connection,
            provider=provider,
            integration=integration,
        )

    @intercept_exceptions()
    @handle_gateway_exceptions()
    async def relay_custom(self, request: Request, slug: str) -> Response:
        return await self._relay(
            request=request,
            namespace=GatewayEndpointNamespace.CUSTOM,
            name=slug,
        )

    async def reject_stream_verbs(self) -> Response:
        return Response(status_code=status.HTTP_405_METHOD_NOT_ALLOWED)
