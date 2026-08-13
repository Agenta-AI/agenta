"""LLM gateway management CRUD router (entities.md §9).

`LlmGatewayService` is WP7's — declared here only as a `TYPE_CHECKING` forward reference
so this router can be built, wired and unit-tested against a mock before WP7 lands (rule
4: "stop at the merge point").

The SSRF gate at registration (D28): `LlmEndpointData.route.base_url` is the LLM plane's
equivalent of the MCP plane's `data.url` — a user-typed upstream URL for a custom endpoint
(every row this router writes is custom by construction, same as MCP). Unlike the MCP url
it is optional (only some deployments set a base URL), so the gate only runs when it is
set. Gated with the no-DNS `validate_url_format_and_literal_ip` (save-time; the resolving
variant runs again at relay time in WP6) — no new guard written, exact precedent
`core/secrets/dtos.py:140`.
"""

from typing import TYPE_CHECKING
from uuid import UUID

from fastapi import APIRouter, HTTPException, Request, status

from oss.src.apis.fastapi.gateways.exceptions import handle_gateway_exceptions
from oss.src.apis.fastapi.gateways.llms.models import (
    LlmEndpointCreateRequest,
    LlmEndpointEditRequest,
    LlmEndpointQueryRequest,
    LlmEndpointResponse,
    LlmEndpointsResponse,
)
from oss.src.apis.fastapi.shared.exceptions import FORBIDDEN_EXCEPTION
from oss.src.core.access.permissions.service import check_action_access
from oss.src.core.access.permissions.types import Permission
from oss.src.core.gateways.dtos import GatewayEndpointNamespace
from oss.src.core.gateways.llms.types import LlmEndpointNotFoundError
from oss.src.core.webhooks.utils import validate_url_format_and_literal_ip
from oss.src.utils.context import AuthScope, get_auth_scope
from oss.src.utils.exceptions import intercept_exceptions

if TYPE_CHECKING:
    from oss.src.core.gateways.llms.service import LlmGatewayService


def _guard_custom_endpoint_base_url(*, base_url) -> None:
    """SSRF gate at registration (D28) — no-DNS variant; never a leaked ValueError.

    `base_url` is optional on `LlmEndpointRoute`; only some deployments set one."""
    if not base_url:
        return
    try:
        validate_url_format_and_literal_ip(base_url)
    except ValueError as e:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"endpoint.data.route.base_url is invalid: {e}",
        ) from e


class LlmGatewayRouter:
    def __init__(self, *, llm_gateway_service: "LlmGatewayService"):
        self.service = llm_gateway_service
        self.router = APIRouter()

        self.router.add_api_route(
            "/endpoints/",
            self.create_endpoint,
            methods=["POST"],
            operation_id="create_llm_endpoint",
            response_model=LlmEndpointResponse,
            response_model_exclude_none=True,
        )
        self.router.add_api_route(
            "/endpoints/",
            self.list_endpoints,
            methods=["GET"],
            operation_id="list_llm_endpoints",
            response_model=LlmEndpointsResponse,
            response_model_exclude_none=True,
        )
        # GET /endpoints/ is the merged listing — generated + custom (§8);
        # POST /endpoints/query filters rows only, because generated endpoints
        # have nothing to filter on but the provider, which GET already shows.
        self.router.add_api_route(
            "/endpoints/query",
            self.query_endpoints,
            methods=["POST"],
            operation_id="query_llm_endpoints",
            response_model=LlmEndpointsResponse,
            response_model_exclude_none=True,
        )
        self.router.add_api_route(
            "/endpoints/{endpoint_id}",
            self.fetch_endpoint,
            methods=["GET"],
            operation_id="fetch_llm_endpoint",
            response_model=LlmEndpointResponse,
            response_model_exclude_none=True,
        )
        self.router.add_api_route(
            "/endpoints/{endpoint_id}",
            self.edit_endpoint,
            methods=["PUT"],
            operation_id="edit_llm_endpoint",
            response_model=LlmEndpointResponse,
            response_model_exclude_none=True,
        )
        self.router.add_api_route(
            "/endpoints/{endpoint_id}",
            self.delete_endpoint,
            methods=["DELETE"],
            operation_id="delete_llm_endpoint",
            status_code=status.HTTP_204_NO_CONTENT,
        )

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
        body: LlmEndpointCreateRequest,
    ) -> LlmEndpointResponse:
        scope = get_auth_scope()
        await self._check(scope, Permission.EDIT_LLM_ENDPOINTS)

        _guard_custom_endpoint_base_url(base_url=body.endpoint.data.route.base_url)

        endpoint = await self.service.create_endpoint(
            project_id=scope.project_id,
            user_id=scope.user_id,
            #
            endpoint=body.endpoint,
        )

        return LlmEndpointResponse(count=1 if endpoint else 0, endpoint=endpoint)

    @intercept_exceptions()
    @handle_gateway_exceptions()
    async def list_endpoints(
        self,
        request: Request,
    ) -> LlmEndpointsResponse:
        scope = get_auth_scope()
        await self._check(scope, Permission.VIEW_LLM_ENDPOINTS)

        endpoints = await self.service.list_endpoints(scope=scope)

        return LlmEndpointsResponse(count=len(endpoints), endpoints=endpoints)

    @intercept_exceptions()
    @handle_gateway_exceptions()
    async def query_endpoints(
        self,
        request: Request,
        *,
        body: LlmEndpointQueryRequest,
    ) -> LlmEndpointsResponse:
        scope = get_auth_scope()
        await self._check(scope, Permission.VIEW_LLM_ENDPOINTS)

        endpoints = await self.service.query_endpoints(
            project_id=scope.project_id,
            #
            endpoint=body.endpoint,
            #
            windowing=body.windowing,
        )

        return LlmEndpointsResponse(count=len(endpoints), endpoints=endpoints)

    @intercept_exceptions()
    @handle_gateway_exceptions()
    async def fetch_endpoint(
        self,
        request: Request,
        *,
        endpoint_id: UUID,
    ) -> LlmEndpointResponse:
        scope = get_auth_scope()
        await self._check(scope, Permission.VIEW_LLM_ENDPOINTS)

        endpoint = await self.service.fetch_endpoint(
            project_id=scope.project_id,
            #
            endpoint_id=endpoint_id,
        )
        if not endpoint:
            raise LlmEndpointNotFoundError(
                namespace=GatewayEndpointNamespace.CUSTOM,
                name=str(endpoint_id),
            )

        return LlmEndpointResponse(count=1, endpoint=endpoint)

    @intercept_exceptions()
    @handle_gateway_exceptions()
    async def edit_endpoint(
        self,
        request: Request,
        *,
        endpoint_id: UUID,
        body: LlmEndpointEditRequest,
    ) -> LlmEndpointResponse:
        scope = get_auth_scope()
        await self._check(scope, Permission.EDIT_LLM_ENDPOINTS)

        if str(endpoint_id) != str(body.endpoint.id):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Path endpoint_id does not match body id",
            )

        _guard_custom_endpoint_base_url(base_url=body.endpoint.data.route.base_url)

        endpoint = await self.service.edit_endpoint(
            project_id=scope.project_id,
            user_id=scope.user_id,
            #
            endpoint=body.endpoint,
        )
        if not endpoint:
            raise LlmEndpointNotFoundError(
                namespace=GatewayEndpointNamespace.CUSTOM,
                name=str(endpoint_id),
            )

        return LlmEndpointResponse(count=1, endpoint=endpoint)

    @intercept_exceptions()
    @handle_gateway_exceptions()
    async def delete_endpoint(
        self,
        request: Request,
        *,
        endpoint_id: UUID,
    ) -> None:
        scope = get_auth_scope()
        await self._check(scope, Permission.EDIT_LLM_ENDPOINTS)

        deleted = await self.service.delete_endpoint(
            project_id=scope.project_id,
            #
            endpoint_id=endpoint_id,
        )
        if not deleted:
            raise LlmEndpointNotFoundError(
                namespace=GatewayEndpointNamespace.CUSTOM,
                name=str(endpoint_id),
            )
