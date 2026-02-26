import html as html_lib
import json
import re
from datetime import datetime, timezone
from functools import wraps
from typing import List, Optional
from urllib.parse import urlsplit
from uuid import UUID, uuid4

import httpx
from fastapi import APIRouter, HTTPException, Query, Request, status
from fastapi.responses import HTMLResponse, JSONResponse

from oss.src.utils.exceptions import intercept_exceptions
from oss.src.utils.logging import get_module_logger
from oss.src.utils.caching import get_cache, set_cache
from oss.src.utils.common import is_ee

from oss.src.apis.fastapi.tools.models import (
    ToolCatalogActionResponse,
    ToolCatalogActionsResponse,
    ToolCatalogIntegrationResponse,
    ToolCatalogIntegrationsResponse,
    ToolCatalogProviderResponse,
    ToolCatalogProvidersResponse,
    #
    ToolConnectionCreateRequest,
    ToolConnectionResponse,
    ToolConnectionsResponse,
    #
    ToolCallResponse,
)

from oss.src.core.shared.dtos import Status
from oss.src.core.tools.dtos import (
    ToolCatalogActionDetails,  # noqa: F401
    ToolCatalogProviderDetails,  # noqa: F401
    ToolCatalogIntegrationDetails,  # noqa: F401
    #
    ToolCall,
    ToolResult,
    ToolResultData,
)
from oss.src.core.tools.exceptions import (
    AdapterError,
    ConnectionInactiveError,
    ConnectionInvalidError,
    ConnectionNotFoundError,
)
from oss.src.core.tools.service import (
    ToolsService,
)
from oss.src.core.tools.utils import decode_oauth_state
from oss.src.utils.env import env

_SLUG_SEGMENT_RE = re.compile(r"^[a-zA-Z0-9_-]+$")

if is_ee():
    from ee.src.models.shared_models import Permission
    from ee.src.utils.permissions import check_action_access, FORBIDDEN_EXCEPTION

log = get_module_logger(__name__)


def handle_adapter_exceptions():
    """Convert only upstream 401 AdapterError failures to 424 Failed Dependency."""

    def decorator(func):
        @wraps(func)
        async def wrapper(*args, **kwargs):
            try:
                return await func(*args, **kwargs)
            except AdapterError as e:
                cause = e.__cause__
                if not (
                    isinstance(cause, httpx.HTTPStatusError)
                    and cause.response is not None
                    and cause.response.status_code == status.HTTP_401_UNAUTHORIZED
                ):
                    raise

                raise HTTPException(
                    status_code=status.HTTP_424_FAILED_DEPENDENCY,
                    detail=e.message,
                ) from e

        return wrapper

    return decorator


class ToolsRouter:
    def __init__(
        self,
        *,
        tools_service: ToolsService,
    ):
        self.tools_service = tools_service

        self.router = APIRouter()

        # --- Tool Catalog ---
        self.router.add_api_route(
            "/catalog/providers/",
            self.list_providers,
            methods=["GET"],
            operation_id="list_tool_providers",
            response_model=ToolCatalogProvidersResponse,
            response_model_exclude_none=True,
        )
        self.router.add_api_route(
            "/catalog/providers/{provider_key}",
            self.get_provider,
            methods=["GET"],
            operation_id="get_tool_provider",
            response_model=ToolCatalogProviderResponse,
            response_model_exclude_none=True,
        )
        self.router.add_api_route(
            "/catalog/providers/{provider_key}/integrations/",
            self.list_integrations,
            methods=["GET"],
            operation_id="list_tool_integrations",
            response_model=ToolCatalogIntegrationsResponse,
            response_model_exclude_none=True,
        )
        self.router.add_api_route(
            "/catalog/providers/{provider_key}/integrations/{integration_key}",
            self.get_integration,
            methods=["GET"],
            operation_id="get_tool_integration",
            response_model=ToolCatalogIntegrationResponse,
            response_model_exclude_none=True,
        )
        self.router.add_api_route(
            "/catalog/providers/{provider_key}/integrations/{integration_key}/actions/",
            self.list_actions,
            methods=["GET"],
            operation_id="list_tool_actions",
            response_model=ToolCatalogActionsResponse,
            response_model_exclude_none=True,
        )
        self.router.add_api_route(
            "/catalog/providers/{provider_key}/integrations/{integration_key}/actions/{action_key}",
            self.get_action,
            methods=["GET"],
            operation_id="get_tool_action",
            response_model=ToolCatalogActionResponse,
            response_model_exclude_none=True,
        )

        # --- Tool Connections ---
        self.router.add_api_route(
            "/connections/query",
            self.query_connections,
            methods=["POST"],
            operation_id="query_tool_connections",
            response_model=ToolConnectionsResponse,
            response_model_exclude_none=True,
        )
        self.router.add_api_route(
            "/connections/",
            self.create_connection,
            methods=["POST"],
            operation_id="create_tool_connection",
            response_model=ToolConnectionResponse,
            response_model_exclude_none=True,
        )
        self.router.add_api_route(
            "/connections/callback",
            self.callback_connection,
            methods=["GET"],
            operation_id="callback_tool_connection",
        )
        self.router.add_api_route(
            "/connections/{connection_id}",
            self.get_connection,
            methods=["GET"],
            operation_id="get_tool_connection",
            response_model=ToolConnectionResponse,
            response_model_exclude_none=True,
        )
        self.router.add_api_route(
            "/connections/{connection_id}",
            self.delete_connection,
            methods=["DELETE"],
            operation_id="delete_tool_connection",
            status_code=status.HTTP_204_NO_CONTENT,
        )
        self.router.add_api_route(
            "/connections/{connection_id}/refresh",
            self.refresh_connection,
            methods=["POST"],
            operation_id="refresh_tool_connection",
            response_model=ToolConnectionResponse,
            response_model_exclude_none=True,
        )
        self.router.add_api_route(
            "/connections/{connection_id}/revoke",
            self.revoke_connection,
            methods=["POST"],
            operation_id="revoke_tool_connection",
            response_model=ToolConnectionResponse,
            response_model_exclude_none=True,
        )

        # --- Tool operations ---
        self.router.add_api_route(
            "/call",
            self.call_tool,
            methods=["POST"],
            operation_id="call_tool",
            response_model=ToolCallResponse,
            response_model_exclude_none=True,
        )

    # -----------------------------------------------------------------------
    # Tool Catalog
    # -----------------------------------------------------------------------

    @intercept_exceptions()
    @handle_adapter_exceptions()
    async def list_providers(
        self,
        request: Request,
        *,
        full_details: bool = Query(default=False),
    ) -> ToolCatalogProvidersResponse:
        if is_ee():
            has_permission = await check_action_access(
                project_id=request.state.project_id,
                user_uid=request.state.user_id,
                permission=Permission.VIEW_TOOLS,
            )
            if not has_permission:
                raise FORBIDDEN_EXCEPTION

        cache_key = {
            "full_details": full_details,
        }
        cached = await get_cache(
            project_id=None,  # catalog is global; not per-project
            namespace="tools:catalog:providers",
            key=cache_key,
            model=ToolCatalogProvidersResponse,
        )
        if cached:
            return cached

        providers = await self.tools_service.list_providers()
        items = list(providers)

        response = ToolCatalogProvidersResponse(
            count=len(items),
            providers=items,
        )

        await set_cache(
            project_id=None,  # catalog is global; not per-project
            namespace="tools:catalog:providers",
            key=cache_key,
            value=response,
            ttl=5 * 60,  # 5 minutes
        )

        return response

    @intercept_exceptions()
    @handle_adapter_exceptions()
    async def get_provider(
        self,
        request: Request,
        provider_key: str,
        *,
        full_details: bool = Query(default=True),
    ) -> ToolCatalogProviderResponse:
        if is_ee():
            has_permission = await check_action_access(
                user_uid=request.state.user_id,
                project_id=request.state.project_id,
                permission=Permission.VIEW_TOOLS,
            )
            if not has_permission:
                raise FORBIDDEN_EXCEPTION

        cache_key = {
            "provider_key": provider_key,
            "full_details": full_details,
        }
        cached = await get_cache(
            project_id=None,  # catalog is global; not per-project
            namespace="tools:catalog:provider",
            key=cache_key,
            model=ToolCatalogProviderResponse,
        )
        if cached:
            return cached

        provider = await self.tools_service.get_provider(
            provider_key=provider_key,
        )
        if not provider:
            return JSONResponse(
                status_code=404,
                content={"detail": "Provider not found"},
            )

        response = ToolCatalogProviderResponse(
            count=1,
            provider=provider,
        )

        await set_cache(
            project_id=None,  # catalog is global; not per-project
            namespace="tools:catalog:provider",
            key=cache_key,
            value=response,
            ttl=5 * 60,  # 5 minutes
        )

        return response

    @intercept_exceptions()
    @handle_adapter_exceptions()
    async def list_integrations(
        self,
        request: Request,
        provider_key: str,
        *,
        search: Optional[str] = Query(default=None),
        sort_by: Optional[str] = Query(default=None),
        limit: Optional[int] = Query(default=None),
        cursor: Optional[str] = Query(default=None),
        full_details: bool = Query(default=False),
    ) -> ToolCatalogIntegrationsResponse:
        if is_ee():
            has_permission = await check_action_access(
                user_uid=request.state.user_id,
                project_id=request.state.project_id,
                permission=Permission.VIEW_TOOLS,
            )
            if not has_permission:
                raise FORBIDDEN_EXCEPTION

        cache_key = {
            "provider_key": provider_key,
            "search": search,
            "sort_by": sort_by,
            "limit": limit,
            "cursor": cursor,
            "full_details": full_details,
        }
        cached = await get_cache(
            project_id=None,  # catalog is global; not per-project
            namespace="tools:catalog:integrations",
            key=cache_key,
            model=ToolCatalogIntegrationsResponse,
        )
        if cached:
            return cached

        integrations, next_cursor, total = await self.tools_service.list_integrations(
            provider_key=provider_key,
            search=search,
            sort_by=sort_by,
            limit=limit,
            cursor=cursor,
        )
        items = list(integrations)

        response = ToolCatalogIntegrationsResponse(
            count=len(items),
            total=total,
            cursor=next_cursor,
            integrations=items,
        )

        await set_cache(
            project_id=None,  # catalog is global; not per-project
            namespace="tools:catalog:integrations",
            key=cache_key,
            value=response,
            ttl=5 * 60,  # 5 minutes
        )

        return response

    @intercept_exceptions()
    @handle_adapter_exceptions()
    async def get_integration(
        self,
        request: Request,
        provider_key: str,
        integration_key: str,
        *,
        full_details: bool = Query(default=True),
    ) -> ToolCatalogIntegrationResponse:
        if is_ee():
            has_permission = await check_action_access(
                user_uid=request.state.user_id,
                project_id=request.state.project_id,
                permission=Permission.VIEW_TOOLS,
            )
            if not has_permission:
                raise FORBIDDEN_EXCEPTION

        cache_key = {
            "provider_key": provider_key,
            "integration_key": integration_key,
            "full_details": full_details,
        }
        cached = await get_cache(
            project_id=None,  # catalog is global; not per-project
            namespace="tools:catalog:integration",
            key=cache_key,
            model=ToolCatalogIntegrationResponse,
        )
        if cached:
            return cached

        integration = await self.tools_service.get_integration(
            provider_key=provider_key,
            integration_key=integration_key,
        )
        if not integration:
            return JSONResponse(
                status_code=404,
                content={"detail": "Integration not found"},
            )

        response = ToolCatalogIntegrationResponse(
            count=1,
            integration=integration,
        )

        await set_cache(
            project_id=None,  # catalog is global; not per-project
            namespace="tools:catalog:integration",
            key=cache_key,
            value=response,
            ttl=5 * 60,  # 5 minutes
        )

        return response

    @intercept_exceptions()
    @handle_adapter_exceptions()
    async def list_actions(
        self,
        request: Request,
        provider_key: str,
        integration_key: str,
        *,
        query: Optional[str] = Query(default=None),
        categories: Optional[List[str]] = Query(default=None),
        limit: Optional[int] = Query(default=None),
        cursor: Optional[str] = Query(default=None),
        full_details: bool = Query(default=False),
    ) -> ToolCatalogActionsResponse:
        if is_ee():
            has_permission = await check_action_access(
                user_uid=request.state.user_id,
                project_id=request.state.project_id,
                permission=Permission.VIEW_TOOLS,
            )
            if not has_permission:
                raise FORBIDDEN_EXCEPTION

        cache_key = {
            "provider_key": provider_key,
            "integration_key": integration_key,
            "query": query,
            "categories": categories,
            "limit": limit,
            "cursor": cursor,
            "full_details": full_details,
        }
        cached = await get_cache(
            project_id=None,  # catalog is global; not per-project
            namespace="tools:catalog:actions",
            key=cache_key,
            model=ToolCatalogActionsResponse,
        )
        if cached:
            return cached

        actions, next_cursor, total = await self.tools_service.list_actions(
            provider_key=provider_key,
            integration_key=integration_key,
            query=query,
            categories=categories,
            limit=limit,
            cursor=cursor,
        )
        items = []

        for action in actions:
            if full_details:
                # Call route handler to benefit from cache reuse
                action_response = await self.get_action(
                    request=request,
                    provider_key=provider_key,
                    integration_key=integration_key,
                    action_key=action.key,
                    full_details=full_details,
                )
                if action_response.action:
                    items.append(action_response.action)
                    continue

            items.append(action)

        response = ToolCatalogActionsResponse(
            count=len(items),
            total=total,
            cursor=next_cursor,
            actions=items,
        )

        await set_cache(
            project_id=None,  # catalog is global; not per-project
            namespace="tools:catalog:actions",
            key=cache_key,
            value=response,
            ttl=5 * 60,  # 5 minutes
        )

        return response

    @intercept_exceptions()
    @handle_adapter_exceptions()
    async def get_action(
        self,
        request: Request,
        provider_key: str,
        integration_key: str,
        action_key: str,
        *,
        full_details: bool = Query(default=True),
    ) -> ToolCatalogActionResponse:
        if is_ee():
            has_permission = await check_action_access(
                user_uid=request.state.user_id,
                project_id=request.state.project_id,
                permission=Permission.VIEW_TOOLS,
            )
            if not has_permission:
                raise FORBIDDEN_EXCEPTION

        cache_key = {
            "provider_key": provider_key,
            "integration_key": integration_key,
            "action_key": action_key,
            "full_details": full_details,
        }
        cached = await get_cache(
            project_id=None,  # catalog is global; not per-project
            namespace="tools:catalog:action",
            key=cache_key,
            model=ToolCatalogActionResponse,
        )
        if cached:
            return cached

        action = await self.tools_service.get_action(
            provider_key=provider_key,
            integration_key=integration_key,
            action_key=action_key,
        )
        if not action:
            return JSONResponse(
                status_code=404,
                content={"detail": "Action not found"},
            )

        response = ToolCatalogActionResponse(
            count=1,
            action=action,
        )

        await set_cache(
            project_id=None,  # catalog is global; not per-project
            namespace="tools:catalog:action",
            key=cache_key,
            value=response,
            ttl=5 * 60,  # 5 minutes
        )

        return response

    # -----------------------------------------------------------------------
    # Tool Connections
    # -----------------------------------------------------------------------

    @intercept_exceptions()
    async def query_connections(
        self,
        request: Request,
        *,
        provider_key: Optional[str] = Query(default=None),
        integration_key: Optional[str] = Query(default=None),
    ) -> ToolConnectionsResponse:
        """Query connections with optional filtering."""
        if is_ee():
            has_permission = await check_action_access(
                user_uid=request.state.user_id,
                project_id=request.state.project_id,
                permission=Permission.VIEW_TOOLS,
            )
            if not has_permission:
                raise FORBIDDEN_EXCEPTION

        connections = await self.tools_service.query_connections(
            project_id=UUID(request.state.project_id),
            provider_key=provider_key,
            integration_key=integration_key,
        )
        return ToolConnectionsResponse(
            count=len(connections),
            connections=connections,
        )

    @intercept_exceptions()
    async def create_connection(
        self,
        request: Request,
        *,
        body: ToolConnectionCreateRequest,
    ) -> ToolConnectionResponse:
        """Create a new tool connection."""
        if is_ee():
            has_permission = await check_action_access(
                user_uid=request.state.user_id,
                project_id=request.state.project_id,
                permission=Permission.EDIT_TOOLS,
            )
            if not has_permission:
                raise FORBIDDEN_EXCEPTION

        slug = body.connection.slug
        if "." in slug or "__" in slug:
            return JSONResponse(
                status_code=422,
                content={
                    "detail": (
                        "Connection slug must not contain dots or "
                        "consecutive underscores. "
                        "Use single hyphens or underscores as separators."
                    )
                },
            )

        if isinstance(body.connection.data, dict):
            body.connection.data = {
                k: v
                for k, v in body.connection.data.items()
                if k not in {"callback_url", "auth_scheme"}
            } or None

        connection = await self.tools_service.create_connection(
            project_id=UUID(request.state.project_id),
            user_id=UUID(request.state.user_id),
            #
            connection_create=body.connection,
        )

        return ToolConnectionResponse(
            count=1,
            connection=connection,
        )

    @intercept_exceptions()
    async def get_connection(
        self,
        request: Request,
        connection_id: UUID,
    ) -> ToolConnectionResponse:
        """Get a connection by ID."""
        if is_ee():
            has_permission = await check_action_access(
                user_uid=request.state.user_id,
                project_id=request.state.project_id,
                permission=Permission.VIEW_TOOLS,
            )
            if not has_permission:
                raise FORBIDDEN_EXCEPTION

        connection = await self.tools_service.get_connection(
            project_id=UUID(request.state.project_id),
            connection_id=connection_id,
        )
        if not connection:
            return JSONResponse(
                status_code=404,
                content={"detail": "Connection not found"},
            )

        return ToolConnectionResponse(
            count=1,
            connection=connection,
        )

    @intercept_exceptions()
    async def delete_connection(
        self,
        request: Request,
        connection_id: UUID,
    ) -> None:
        """Delete a connection by ID."""
        if is_ee():
            has_permission = await check_action_access(
                user_uid=request.state.user_id,
                project_id=request.state.project_id,
                permission=Permission.EDIT_TOOLS,
            )
            if not has_permission:
                raise FORBIDDEN_EXCEPTION

        await self.tools_service.delete_connection(
            project_id=UUID(request.state.project_id),
            connection_id=connection_id,
        )

    @intercept_exceptions()
    async def refresh_connection(
        self,
        request: Request,
        connection_id: UUID,
        *,
        force: bool = Query(default=False),
    ) -> ToolConnectionResponse:
        """Refresh a connection's credentials."""
        if is_ee():
            has_permission = await check_action_access(
                user_uid=request.state.user_id,
                project_id=request.state.project_id,
                permission=Permission.EDIT_TOOLS,
            )
            if not has_permission:
                raise FORBIDDEN_EXCEPTION

        connection = await self.tools_service.refresh_connection(
            project_id=UUID(request.state.project_id),
            connection_id=connection_id,
            force=force,
        )

        return ToolConnectionResponse(
            count=1,
            connection=connection,
        )

    @intercept_exceptions()
    async def revoke_connection(
        self,
        request: Request,
        connection_id: UUID,
    ) -> ToolConnectionResponse:
        """Mark a connection invalid locally (does not revoke at the provider)."""
        if is_ee():
            has_permission = await check_action_access(
                user_uid=request.state.user_id,
                project_id=request.state.project_id,
                permission=Permission.EDIT_TOOLS,
            )
            if not has_permission:
                raise FORBIDDEN_EXCEPTION

        connection = await self.tools_service.revoke_connection(
            project_id=UUID(request.state.project_id),
            connection_id=connection_id,
        )

        return ToolConnectionResponse(
            count=1,
            connection=connection,
        )

    async def callback_connection(
        self,
        request: Request,
        *,
        connected_account_id: Optional[str] = Query(default=None),
        status: Optional[str] = Query(default=None),
        error_message: Optional[str] = Query(default=None),
        state: Optional[str] = Query(default=None),
    ) -> HTMLResponse:
        """Handle OAuth callback from Composio."""
        if error_message or status == "failed":
            log.error("OAuth callback failed: status=%s", status)
            return HTMLResponse(
                status_code=400,
                content=_oauth_card(
                    success=False,
                    error=error_message or "Authorization failed. Please try again.",
                ),
            )

        if not connected_account_id:
            return HTMLResponse(
                status_code=400,
                content=_oauth_card(
                    success=False,
                    error="Missing connection identifier. Please try again.",
                ),
            )

        # Decode HMAC-signed state to recover project scope.
        project_id: Optional[UUID] = None
        if state:
            payload = decode_oauth_state(state, secret_key=env.agenta.crypt_key)
            if payload is None:
                log.warning("OAuth callback: invalid or expired state token")
            else:
                try:
                    project_id = UUID(payload["project_id"])
                except (KeyError, ValueError):
                    log.warning("OAuth callback state missing or invalid project_id")
        else:
            log.warning("OAuth callback received without state token")

        # Activate the connection — this is the critical path.
        conn = None
        try:
            conn = (
                await self.tools_service.activate_connection_by_provider_connection_id(
                    provider_connection_id=connected_account_id,
                    project_id=project_id,
                )
            )
            if not conn:
                log.error("OAuth callback: connection not found for provider ID")
                return HTMLResponse(
                    status_code=400,
                    content=_oauth_card(
                        success=False,
                        error="Connection could not be activated. Please try again.",
                    ),
                )
        except Exception:
            log.error("OAuth callback: failed to activate connection", exc_info=True)
            return HTMLResponse(
                status_code=500,
                content=_oauth_card(
                    success=False,
                    error="An internal error occurred. Please try again.",
                ),
            )

        # Fetch integration metadata for the success card (best-effort decoration).
        integration_label = conn.integration_key.replace("_", " ").title()
        integration_logo = None
        integration_url = None
        try:
            integration = await self.tools_service.get_integration(
                provider_key=conn.provider_key.value,
                integration_key=conn.integration_key,
            )
            if integration:
                integration_logo = integration.logo
                integration_url = integration.url
        except Exception:
            log.warning(
                "OAuth callback: could not fetch integration metadata",
                exc_info=True,
            )

        return HTMLResponse(
            status_code=200,
            content=_oauth_card(
                success=True,
                integration_label=integration_label,
                integration_logo=integration_logo,
                integration_url=integration_url,
                agenta_url=env.agenta.web_url,
            ),
        )

    # -----------------------------------------------------------------------
    # Tool Calls
    # -----------------------------------------------------------------------

    @intercept_exceptions()
    @handle_adapter_exceptions()
    async def call_tool(
        self,
        request: Request,
        *,
        body: ToolCall,
    ) -> ToolCallResponse:
        """Call a tool action with a connection."""
        if is_ee():
            has_permission = await check_action_access(
                user_uid=request.state.user_id,
                project_id=request.state.project_id,
                permission=Permission.RUN_TOOLS,
            )
            if not has_permission:
                raise FORBIDDEN_EXCEPTION

        # Parse tool slug — accept both dot and double-underscore formats.
        # Double-underscore is used for LLM function names where dots are forbidden.
        slug_parts = body.data.function.name.replace("__", ".").split(".")

        if len(slug_parts) != 5 or slug_parts[0] != "tools":
            raise HTTPException(
                status_code=400,
                detail=(
                    f"Invalid tool slug format: {body.data.function.name}. "
                    "Expected: tools.{provider}.{integration}.{action}.{connection}"
                ),
            )

        # Validate each segment against safe allowlist to prevent injection.
        for segment in slug_parts[1:]:
            if not _SLUG_SEGMENT_RE.match(segment):
                raise HTTPException(
                    status_code=400,
                    detail=f"Invalid characters in tool slug segment: {segment!r}",
                )

        provider_key = slug_parts[1]
        integration_key = slug_parts[2]
        action_key = slug_parts[3]
        connection_slug = slug_parts[4]

        try:
            connections = await self.tools_service.query_connections(
                project_id=UUID(request.state.project_id),
                provider_key=provider_key,
                integration_key=integration_key,
            )

            connection = next(
                (c for c in connections if c.slug == connection_slug), None
            )

            if not connection:
                raise ConnectionNotFoundError(
                    connection_slug=connection_slug,
                    provider_key=provider_key,
                    integration_key=integration_key,
                )

            if not connection.is_active:
                raise ConnectionInactiveError(connection_id=connection_slug)

            if not connection.is_valid:
                raise ConnectionInvalidError(
                    connection_slug=connection_slug,
                    detail="Please refresh the connection.",
                )

            if not connection.provider_connection_id:
                raise ConnectionNotFoundError(
                    connection_slug=connection_slug,
                    detail="Connection has no provider connection ID.",
                )

        except ConnectionNotFoundError as e:
            raise HTTPException(status_code=404, detail=e.message) from e
        except ConnectionInactiveError as e:
            raise HTTPException(status_code=400, detail=e.message) from e
        except ConnectionInvalidError as e:
            raise HTTPException(status_code=400, detail=e.message) from e

        # Use stored project_id as Composio user_id (matches entity used at initiation)
        user_id = (
            connection.data.get("project_id")
            if isinstance(connection.data, dict)
            else None
        )

        # Parse arguments — OpenAI returns them as a JSON string; normalise to dict.
        arguments = body.data.function.arguments
        if isinstance(arguments, str):
            try:
                arguments = json.loads(arguments)
            except json.JSONDecodeError as e:
                log.warning("Failed to parse tool arguments as JSON: %s", e)
                arguments = {}
        elif not isinstance(arguments, dict):
            arguments = {}

        # Execute the tool via the adapter.
        # Upstream 401 AdapterError (e.g. bad API key) → @handle_adapter_exceptions → 424.
        # Other adapter errors are treated as internal failures; unsuccessful tool
        # execution responses remain business-level errors → 200.
        execution_result = await self.tools_service.execute_tool(
            provider_key=provider_key,
            integration_key=integration_key,
            action_key=action_key,
            provider_connection_id=connection.provider_connection_id,
            user_id=user_id,
            arguments=arguments,
        )

        result = ToolResult(
            id=uuid4(),
            data=ToolResultData(
                tool_call_id=body.data.id,
                content=json.dumps(execution_result.model_dump()),
            ),
            status=Status(
                timestamp=datetime.now(timezone.utc),
                code="STATUS_CODE_OK"
                if execution_result.successful
                else "STATUS_CODE_ERROR",
                message=execution_result.error,
            ),
        )

        return ToolCallResponse(call=result)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _oauth_card(
    *,
    success: bool,
    integration_label: Optional[str] = None,
    integration_logo: Optional[str] = None,
    integration_url: Optional[str] = None,
    agenta_url: Optional[str] = None,
    error: Optional[str] = None,
) -> str:
    # HTML-escape all provider-supplied strings before interpolation.
    safe_label = html_lib.escape(integration_label) if integration_label else None
    safe_logo = html_lib.escape(integration_logo) if integration_logo else None
    safe_url = html_lib.escape(integration_url) if integration_url else None
    safe_agenta_url = html_lib.escape(agenta_url) if agenta_url else None
    safe_error = html_lib.escape(error) if error else None
    agenta_origin = None
    if agenta_url:
        parsed_agenta_url = urlsplit(agenta_url)
        if parsed_agenta_url.scheme and parsed_agenta_url.netloc:
            agenta_origin = f"{parsed_agenta_url.scheme}://{parsed_agenta_url.netloc}"
    agenta_post_message_origin_js = json.dumps(agenta_origin)

    accent = "#16a34a" if success else "#dc2626"
    agenta_favicon = (
        f"{safe_agenta_url}/assets/favicon.ico" if safe_agenta_url else None
    )

    # Logo row: Agenta <> Integration (or single checkmark/cross on error)
    if success and (agenta_favicon or safe_logo):
        onerror_js = "this.style.display='none'"
        agenta_img = (
            f'<img src="{agenta_favicon}" alt="Agenta" class="logo logo-sm" onerror="{onerror_js}" />'  # noqa: E501
            if agenta_favicon
            else '<div class="logo-placeholder">A</div>'
        )
        int_alt = safe_label or ""
        int_initial = (safe_label or "?")[0]
        integration_img = (
            f'<img src="{safe_logo}" alt="{int_alt}" class="logo" />'
            if safe_logo
            else f'<div class="logo-placeholder">{int_initial}</div>'
        )
        logos_html = f"""
    <div class="logos">
      {agenta_img}
      <span class="connector">&#8596;</span>
      {integration_img}
    </div>"""
    else:
        icon = "✓" if success else "✕"
        logos_html = f'<div class="status-icon">{icon}</div>'

    # Single-line heading or error message
    if success:
        name = safe_label or "the integration"
        heading_html = f'<p class="h-line"><strong>Agenta</strong> successfully connected to <strong>{name}</strong></p>'  # noqa: E501
    else:
        heading_html = f'<p class="h-error">{safe_error or "Something went wrong"}</p>'

    agenta_btn = (
        '<button id="agenta-return-btn" type="button" class="btn btn-primary" onclick="returnToAgenta(event);">Return to Agenta</button>'  # noqa: E501
        if safe_agenta_url
        else ""
    )
    go_to_label = f"Go to {safe_label}" if safe_label else "Go to Integration"
    integration_btn = (
        f'<a href="{safe_url}" target="_blank" rel="noopener noreferrer" class="btn btn-secondary">{go_to_label}</a>'  # noqa: E501
        if safe_url
        else ""
    )
    auto_return_html = (
        '<p id="auto-return-text" class="auto-return">This tab will close automatically in 5 seconds...</p>'  # noqa: E501
        if success and safe_agenta_url
        else ""
    )
    button_html = (
        f'<div class="buttons">{agenta_btn}{integration_btn}</div>{auto_return_html}'
        if agenta_btn or integration_btn
        else auto_return_html
    )

    return f"""<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Agenta ↔ {safe_label or "Integration"}</title>
  <style>
    *, *::before, *::after {{ box-sizing: border-box; margin: 0; padding: 0; }}
    body {{
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      background: #f4f4f5;
      display: flex;
      align-items: center;
      justify-content: center;
      min-height: 100vh;
    }}
    .card {{
      background: #fff;
      border-radius: 16px;
      padding: 48px 40px 40px;
      max-width: 480px;
      width: 90%;
      text-align: center;
      box-shadow: 0 4px 24px rgba(0,0,0,0.08);
    }}
    .logos {{
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 12px;
      margin-bottom: 32px;
    }}
    .logo {{
      width: 48px;
      height: 48px;
      object-fit: contain;
      border-radius: 10px;
    }}
    .logo-sm {{
      width: 32px;
      height: 32px;
      border-radius: 6px;
    }}
    .logo-placeholder {{
      width: 48px;
      height: 48px;
      border-radius: 10px;
      border: 1px solid #e4e4e7;
      background: #f4f4f5;
      color: #71717a;
      font-size: 20px;
      font-weight: 600;
      line-height: 48px;
    }}
    .connector {{
      font-size: 18px;
      color: #a1a1aa;
    }}
    .status-icon {{
      width: 56px;
      height: 56px;
      border-radius: 50%;
      background: {accent}18;
      color: {accent};
      font-size: 26px;
      line-height: 56px;
      margin: 0 auto 32px;
    }}
    .h-line {{
      font-size: 15px;
      font-weight: 400;
      color: #71717a;
      line-height: 1.7;
    }}
    .h-error {{
      font-size: 15px;
      color: {accent};
      line-height: 1.6;
    }}
    .buttons {{
      display: flex;
      flex-direction: column;
      gap: 10px;
      margin-top: 28px;
    }}
    .btn {{
      display: block;
      padding: 10px 24px;
      font-size: 14px;
      font-weight: 500;
      border-radius: 8px;
      text-decoration: none;
      text-align: center;
      border: none;
      cursor: pointer;
    }}
    .btn-primary {{
      background: #18181b;
      color: #fff;
    }}
    .btn-primary:hover {{ background: #3f3f46; }}
    .btn-secondary {{
      background: #f4f4f5;
      color: #3f3f46;
    }}
    .btn-secondary:hover {{ background: #e4e4e7; }}
    .auto-return {{
      margin-top: 10px;
      font-size: 12px;
      color: #a1a1aa;
    }}
  </style>
</head>
<body>
  <div class="card">
    {logos_html}
    {heading_html}
    {button_html}
  </div>
  <script>
    const AGENTA_POST_MESSAGE_ORIGIN = {agenta_post_message_origin_js};

    function returnToAgenta(event) {{
      if (event) {{
        event.preventDefault();
      }}

      try {{
        if (window.opener && !window.opener.closed && AGENTA_POST_MESSAGE_ORIGIN) {{
          window.opener.postMessage({{type: "tools:oauth:complete"}}, AGENTA_POST_MESSAGE_ORIGIN);
          window.opener.focus();
        }}
      }} catch (_e) {{
        // Best effort focus only.
      }}

      try {{
        window.close();
      }} catch (_e) {{
        // Ignore close errors.
      }}
      return false;
    }}

    if (window.opener && AGENTA_POST_MESSAGE_ORIGIN) {{
      window.opener.postMessage({{type: "tools:oauth:complete"}}, AGENTA_POST_MESSAGE_ORIGIN);
    }}

    const countdownEl = document.getElementById("auto-return-text");
    if (countdownEl) {{
      let remaining = 5;

      const render = () => {{
        const suffix = remaining === 1 ? "" : "s";
        countdownEl.textContent =
          "This tab will close automatically in " +
          remaining +
          " second" +
          suffix +
          "...";
      }};

      render();
      const intervalId = setInterval(() => {{
        remaining -= 1;
        if (remaining <= 0) {{
          clearInterval(intervalId);
          returnToAgenta();
          return;
        }}
        render();
      }}, 1000);
    }}
  </script>
</body>
</html>"""
