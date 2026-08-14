"""MCP gateway management CRUD router (entities.md §9).

`MCPGatewayService` is WP9's — declared here only as a `TYPE_CHECKING` forward reference
so this router can be built, wired and unit-tested against a mock before WP9 lands (rule
4: "stop at the merge point").

`connect_mcp_endpoint` (`POST /endpoints/{endpoint_id}/connect`) and `mcp_connect_callback`
(`GET /connect/callback`) are tagged `(WP18)` in entities.md §9 and are NOT wired here —
they land with the OAuth client in wave 3.

The SSRF gate at registration (D28): every `custom` endpoint this router can create or edit
carries a user-typed `data.route.base_url` the gateway will later connect to (`MCPEndpointCreate`/
`MCPEndpointEdit` have no `namespace` field and no way to express `provider_key`/
`integration_key`, so every row this router writes is `custom` by construction — same as
the DAO's own "every row is custom by construction" invariant). Gated here with the no-DNS
`validate_url_format_and_literal_ip` (save-time; the resolving variant runs again at relay
time in WP8) — no new guard written, exact precedent `core/secrets/dtos.py:140`.
"""

from typing import TYPE_CHECKING, Optional
from uuid import UUID

from fastapi import APIRouter, HTTPException, Request, status

from oss.src.apis.fastapi.gateways.exceptions import handle_gateway_exceptions
from oss.src.apis.fastapi.gateways.mcps.models import (
    MCPEndpointCreateRequest,
    MCPEndpointEditRequest,
    MCPEndpointQueryRequest,
    MCPEndpointResponse,
    MCPEndpointsResponse,
)
from oss.src.apis.fastapi.shared.exceptions import FORBIDDEN_EXCEPTION
from oss.src.core.access.permissions.service import check_action_access
from oss.src.core.access.permissions.types import Permission
from oss.src.core.gateways.dtos import GatewayEndpointNamespace
from oss.src.core.gateways.mcps.types import MCPEndpointNotFoundError
from oss.src.core.webhooks.utils import validate_url_format_and_literal_ip
from oss.src.utils.context import AuthScope, get_auth_scope
from oss.src.utils.exceptions import intercept_exceptions

if TYPE_CHECKING:
    from oss.src.core.gateways.mcps.service import MCPGatewayService


def _guard_custom_endpoint_url(*, url: Optional[str]) -> None:
    """SSRF gate at registration (D28) — no-DNS variant; never a leaked ValueError."""
    if not url:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="endpoint.data.route.base_url is required",
        )
    try:
        validate_url_format_and_literal_ip(url)
    except ValueError as e:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"endpoint.data.route.base_url is invalid: {e}",
        ) from e


class MCPGatewayRouter:
    def __init__(self, *, mcp_gateway_service: "MCPGatewayService"):
        self.service = mcp_gateway_service
        self.router = APIRouter()

        self.router.add_api_route(
            "/endpoints/",
            self.create_endpoint,
            methods=["POST"],
            operation_id="create_mcp_endpoint",
            response_model=MCPEndpointResponse,
            response_model_exclude_none=True,
        )
        self.router.add_api_route(
            "/endpoints/",
            self.list_endpoints,
            methods=["GET"],
            operation_id="list_mcp_endpoints",
            response_model=MCPEndpointsResponse,
            response_model_exclude_none=True,
        )
        self.router.add_api_route(
            "/endpoints/query",
            self.query_endpoints,
            methods=["POST"],
            operation_id="query_mcp_endpoints",
            response_model=MCPEndpointsResponse,
            response_model_exclude_none=True,
        )
        self.router.add_api_route(
            "/endpoints/{endpoint_id}",
            self.fetch_endpoint,
            methods=["GET"],
            operation_id="fetch_mcp_endpoint",
            response_model=MCPEndpointResponse,
            response_model_exclude_none=True,
        )
        self.router.add_api_route(
            "/endpoints/{endpoint_id}",
            self.edit_endpoint,
            methods=["PUT"],
            operation_id="edit_mcp_endpoint",
            response_model=MCPEndpointResponse,
            response_model_exclude_none=True,
        )
        self.router.add_api_route(
            "/endpoints/{endpoint_id}",
            self.delete_endpoint,
            methods=["DELETE"],
            operation_id="delete_mcp_endpoint",
            status_code=status.HTTP_204_NO_CONTENT,
        )
        # POST /endpoints/{endpoint_id}/connect (connect_mcp_endpoint) and
        # GET /connect/callback (mcp_connect_callback) are (WP18) — not wired here.

    async def _check(self, scope: AuthScope, permission: Permission) -> None:
        has_permission = await check_action_access(
            user_uid=str(scope.user_id),
            project_id=str(scope.project_id),
            permission=permission,
        )
        if not has_permission:
            raise FORBIDDEN_EXCEPTION

    @intercept_exceptions()
    @handle_gateway_exceptions()
    async def create_endpoint(
        self,
        request: Request,
        *,
        body: MCPEndpointCreateRequest,
    ) -> MCPEndpointResponse:
        scope = get_auth_scope()
        await self._check(scope, Permission.EDIT_MCP_ENDPOINTS)

        _guard_custom_endpoint_url(url=body.endpoint.data.route.base_url)

        endpoint = await self.service.create_endpoint(
            project_id=scope.project_id,
            user_id=scope.user_id,
            #
            endpoint=body.endpoint,
        )

        return MCPEndpointResponse(count=1 if endpoint else 0, endpoint=endpoint)

    @intercept_exceptions()
    @handle_gateway_exceptions()
    async def list_endpoints(
        self,
        request: Request,
    ) -> MCPEndpointsResponse:
        scope = get_auth_scope()
        await self._check(scope, Permission.VIEW_MCP_ENDPOINTS)

        endpoints = await self.service.list_endpoints(scope=scope)

        return MCPEndpointsResponse(count=len(endpoints), endpoints=endpoints)

    @intercept_exceptions()
    @handle_gateway_exceptions()
    async def query_endpoints(
        self,
        request: Request,
        *,
        body: MCPEndpointQueryRequest,
    ) -> MCPEndpointsResponse:
        scope = get_auth_scope()
        await self._check(scope, Permission.VIEW_MCP_ENDPOINTS)

        endpoints = await self.service.query_endpoints(
            project_id=scope.project_id,
            #
            endpoint=body.endpoint,
            #
            windowing=body.windowing,
        )

        return MCPEndpointsResponse(count=len(endpoints), endpoints=endpoints)

    @intercept_exceptions()
    @handle_gateway_exceptions()
    async def fetch_endpoint(
        self,
        request: Request,
        *,
        endpoint_id: UUID,
    ) -> MCPEndpointResponse:
        scope = get_auth_scope()
        await self._check(scope, Permission.VIEW_MCP_ENDPOINTS)

        endpoint = await self.service.fetch_endpoint(
            project_id=scope.project_id,
            #
            endpoint_id=endpoint_id,
        )
        if not endpoint:
            raise MCPEndpointNotFoundError(
                namespace=GatewayEndpointNamespace.CUSTOM,
                name=str(endpoint_id),
            )

        return MCPEndpointResponse(count=1, endpoint=endpoint)

    @intercept_exceptions()
    @handle_gateway_exceptions()
    async def edit_endpoint(
        self,
        request: Request,
        *,
        endpoint_id: UUID,
        body: MCPEndpointEditRequest,
    ) -> MCPEndpointResponse:
        scope = get_auth_scope()
        await self._check(scope, Permission.EDIT_MCP_ENDPOINTS)

        if str(endpoint_id) != str(body.endpoint.id):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Path endpoint_id does not match body id",
            )

        _guard_custom_endpoint_url(url=body.endpoint.data.route.base_url)

        endpoint = await self.service.edit_endpoint(
            project_id=scope.project_id,
            user_id=scope.user_id,
            #
            endpoint=body.endpoint,
        )
        if not endpoint:
            raise MCPEndpointNotFoundError(
                namespace=GatewayEndpointNamespace.CUSTOM,
                name=str(endpoint_id),
            )

        return MCPEndpointResponse(count=1, endpoint=endpoint)

    @intercept_exceptions()
    @handle_gateway_exceptions()
    async def delete_endpoint(
        self,
        request: Request,
        *,
        endpoint_id: UUID,
    ) -> None:
        scope = get_auth_scope()
        await self._check(scope, Permission.EDIT_MCP_ENDPOINTS)

        deleted = await self.service.delete_endpoint(
            project_id=scope.project_id,
            #
            endpoint_id=endpoint_id,
        )
        if not deleted:
            raise MCPEndpointNotFoundError(
                namespace=GatewayEndpointNamespace.CUSTOM,
                name=str(endpoint_id),
            )
