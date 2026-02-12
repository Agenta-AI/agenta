from typing import Optional
from uuid import UUID

from fastapi import APIRouter, Depends, Request, status
from fastapi.responses import HTMLResponse, JSONResponse

from oss.src.utils.exceptions import intercept_exceptions
from oss.src.utils.logging import get_module_logger

from oss.src.core.tools.dtos import (
    ActionQueryRequest,
    ConnectionCreate,
    ToolQuery,
    ToolQueryRequest,
)
from oss.src.core.tools.service import ToolsService

from oss.src.apis.fastapi.tools.models import (
    ActionDetailResponse,
    ActionItem,
    ActionsListResponse,
    ActionsResponse,
    CatalogActionResult,
    ConnectionCreateRequest,
    ConnectionItem,
    ConnectionResponse,
    ConnectionsListResponse,
    ConnectRequest,
    IntegrationDetailResponse,
    IntegrationItem,
    IntegrationsResponse,
    ProviderItem,
    ProvidersResponse,
    RefreshRequest,
    RefreshResponse,
    ToolResult,
    ToolsResponse,
)
from oss.src.apis.fastapi.tools.utils import (
    merge_action_query_requests,
    merge_tool_query_requests,
    parse_action_query_request_from_params,
    parse_tool_query_request_from_params,
    parse_tool_slug,
)


log = get_module_logger(__name__)


class ToolsRouter:
    def __init__(self, tools_service: ToolsService):
        self.tools_service = tools_service
        self.router = APIRouter()

        # --- Catalog browse ---
        self.router.add_api_route(
            "/catalog/providers",
            self.list_providers,
            methods=["GET"],
            operation_id="list_tool_providers",
            response_model=ProvidersResponse,
            response_model_exclude_none=True,
        )
        self.router.add_api_route(
            "/catalog/providers/{provider_key}",
            self.get_provider,
            methods=["GET"],
            operation_id="get_tool_provider",
            response_model=ProviderItem,
            response_model_exclude_none=True,
        )
        self.router.add_api_route(
            "/catalog/providers/{provider_key}/integrations",
            self.list_integrations,
            methods=["GET"],
            operation_id="list_tool_integrations",
            response_model=IntegrationsResponse,
            response_model_exclude_none=True,
        )
        self.router.add_api_route(
            "/catalog/providers/{provider_key}/integrations/{integration_key}",
            self.get_integration,
            methods=["GET"],
            operation_id="get_tool_integration",
            response_model=IntegrationDetailResponse,
            response_model_exclude_none=True,
        )
        self.router.add_api_route(
            "/catalog/providers/{provider_key}/integrations/{integration_key}/actions",
            self.list_actions,
            methods=["GET"],
            operation_id="list_tool_actions",
            response_model=ActionsListResponse,
            response_model_exclude_none=True,
        )
        self.router.add_api_route(
            "/catalog/providers/{provider_key}/integrations/{integration_key}/actions/{action_key}",
            self.get_action,
            methods=["GET"],
            operation_id="get_tool_action",
            response_model=ActionDetailResponse,
            response_model_exclude_none=True,
        )

        # --- Catalog query ---
        self.router.add_api_route(
            "/catalog/query",
            self.query_catalog,
            methods=["POST"],
            operation_id="query_tool_catalog",
            response_model=ActionsResponse,
            response_model_exclude_none=True,
        )

        # --- Connection CRUD (REST) ---
        self.router.add_api_route(
            "/catalog/providers/{provider_key}/integrations/{integration_key}/connections",
            self.list_connections,
            methods=["GET"],
            operation_id="list_tool_connections",
            response_model=ConnectionsListResponse,
            response_model_exclude_none=True,
        )
        self.router.add_api_route(
            "/catalog/providers/{provider_key}/integrations/{integration_key}/connections",
            self.create_connection,
            methods=["POST"],
            operation_id="create_tool_connection",
            status_code=status.HTTP_201_CREATED,
            response_model=ConnectionResponse,
            response_model_exclude_none=True,
        )
        self.router.add_api_route(
            "/catalog/providers/{provider_key}/integrations/{integration_key}/connections/{connection_slug}",
            self.get_connection,
            methods=["GET"],
            operation_id="get_tool_connection",
            response_model=ConnectionItem,
            response_model_exclude_none=True,
        )
        self.router.add_api_route(
            "/catalog/providers/{provider_key}/integrations/{integration_key}/connections/{connection_slug}",
            self.delete_connection,
            methods=["DELETE"],
            operation_id="delete_tool_connection",
            status_code=status.HTTP_204_NO_CONTENT,
        )
        self.router.add_api_route(
            "/catalog/providers/{provider_key}/integrations/{integration_key}/connections/{connection_slug}/refresh",
            self.refresh_connection_rest,
            methods=["POST"],
            operation_id="refresh_tool_connection",
            response_model=RefreshResponse,
            response_model_exclude_none=True,
        )

        # --- Slug-based operations ---
        self.router.add_api_route(
            "/query",
            self.query_tools,
            methods=["POST"],
            operation_id="query_tools",
            response_model=ToolsResponse,
            response_model_exclude_none=True,
        )
        self.router.add_api_route(
            "/connect",
            self.connect,
            methods=["POST"],
            operation_id="connect_tool",
            status_code=status.HTTP_201_CREATED,
            response_model=ConnectionResponse,
            response_model_exclude_none=True,
        )
        self.router.add_api_route(
            "/refresh",
            self.refresh,
            methods=["POST"],
            operation_id="refresh_tool",
            response_model=RefreshResponse,
            response_model_exclude_none=True,
        )
        self.router.add_api_route(
            "/inspect",
            self.inspect,
            methods=["POST"],
            operation_id="inspect_tool",
        )
        self.router.add_api_route(
            "/invoke",
            self.invoke,
            methods=["POST"],
            operation_id="invoke_tool",
        )
        self.router.add_api_route(
            "/callback",
            self.oauth_callback,
            methods=["GET"],
            operation_id="tool_oauth_callback",
        )

    # -----------------------------------------------------------------------
    # Catalog browse handlers
    # -----------------------------------------------------------------------

    @intercept_exceptions()
    async def list_providers(
        self,
        request: Request,
    ) -> ProvidersResponse:
        providers = await self.tools_service.list_providers()
        items = [
            ProviderItem(
                key=p.key,
                name=p.name,
                description=p.description,
                integrations_count=p.integrations_count,
                enabled=p.enabled,
            )
            for p in providers
        ]
        return ProvidersResponse(count=len(items), items=items)

    @intercept_exceptions()
    async def get_provider(
        self,
        request: Request,
        provider_key: str,
    ) -> ProviderItem:
        provider = await self.tools_service.get_provider(
            provider_key=provider_key,
        )
        if not provider:
            return JSONResponse(
                status_code=404, content={"detail": "Provider not found"}
            )

        return ProviderItem(
            key=provider.key,
            name=provider.name,
            description=provider.description,
            integrations_count=provider.integrations_count,
            enabled=provider.enabled,
        )

    @intercept_exceptions()
    async def list_integrations(
        self,
        request: Request,
        provider_key: str,
        *,
        search: Optional[str] = None,
        limit: Optional[int] = None,
    ) -> IntegrationsResponse:
        integrations = await self.tools_service.list_integrations(
            project_id=UUID(request.state.project_id),
            provider_key=provider_key,
            search=search,
            limit=limit,
        )
        items = [
            IntegrationItem(
                key=i.key,
                name=i.name,
                description=i.description,
                logo=i.logo,
                auth_schemes=i.auth_schemes,
                actions_count=i.actions_count,
                categories=i.categories,
                no_auth=i.no_auth,
                connections_count=i.connections_count,
            )
            for i in integrations
        ]
        return IntegrationsResponse(count=len(items), items=items)

    @intercept_exceptions()
    async def get_integration(
        self,
        request: Request,
        provider_key: str,
        integration_key: str,
    ) -> IntegrationDetailResponse:
        integration = await self.tools_service.get_integration(
            project_id=UUID(request.state.project_id),
            provider_key=provider_key,
            integration_key=integration_key,
        )
        if not integration:
            return JSONResponse(
                status_code=404, content={"detail": "Integration not found"}
            )

        connections = await self.tools_service.list_connections(
            project_id=UUID(request.state.project_id),
            provider_key=provider_key,
            integration_key=integration_key,
        )

        return IntegrationDetailResponse(
            key=integration.key,
            name=integration.name,
            description=integration.description,
            logo=integration.logo,
            auth_schemes=integration.auth_schemes,
            actions_count=integration.actions_count,
            categories=integration.categories,
            no_auth=integration.no_auth,
            connections=[
                ConnectionItem(
                    slug=c.slug,
                    name=c.name,
                    description=c.description,
                    is_active=c.is_active,
                    is_valid=c.is_valid,
                    status=c.status,
                    created_at=c.created_at,
                    updated_at=c.updated_at,
                )
                for c in connections
            ],
        )

    @intercept_exceptions()
    async def list_actions(
        self,
        request: Request,
        provider_key: str,
        integration_key: str,
        *,
        search: Optional[str] = None,
        tags: Optional[str] = None,
        important: Optional[bool] = None,
        limit: Optional[int] = None,
    ) -> ActionsListResponse:
        actions = await self.tools_service.list_actions(
            provider_key=provider_key,
            integration_key=integration_key,
            search=search,
            important=important,
            limit=limit,
        )
        items = [
            ActionItem(
                key=a.key,
                slug=f"tools.{provider_key}.{integration_key}.{a.key}",
                name=a.name,
                description=a.description,
                tags=a.tags,
            )
            for a in actions
        ]
        return ActionsListResponse(count=len(items), items=items)

    @intercept_exceptions()
    async def get_action(
        self,
        request: Request,
        provider_key: str,
        integration_key: str,
        action_key: str,
    ) -> ActionDetailResponse:
        action = await self.tools_service.get_action(
            provider_key=provider_key,
            integration_key=integration_key,
            action_key=action_key,
        )
        if not action:
            return JSONResponse(status_code=404, content={"detail": "Action not found"})

        return ActionDetailResponse(
            key=action.key,
            slug=f"tools.{provider_key}.{integration_key}.{action.key}",
            name=action.name,
            description=action.description,
            tags=action.tags,
            input_schema=action.input_schema,
            output_schema=action.output_schema,
        )

    # -----------------------------------------------------------------------
    # Catalog query handler
    # -----------------------------------------------------------------------

    @intercept_exceptions()
    async def query_catalog(
        self,
        request: Request,
        *,
        query_request_params: Optional[ActionQueryRequest] = Depends(
            parse_action_query_request_from_params
        ),
    ) -> ActionsResponse:
        body_json = None
        query_request_body = None

        try:
            body_json = await request.json()
            if body_json:
                query_request_body = ActionQueryRequest(**body_json)
        except Exception:
            pass

        merged = merge_action_query_requests(
            query_request_params,
            query_request_body,
        )

        actions = await self.tools_service.query_catalog(
            action_query=merged.action,
            windowing=merged.windowing,
        )

        return ActionsResponse(
            count=len(actions),
            actions=[
                CatalogActionResult(
                    key=a.key,
                    name=a.name,
                    description=a.description,
                    tags=a.tags,
                    provider_key="composio",  # TODO: enrich from adapter context
                    integration_key="",  # TODO: enrich from adapter context
                    integration_name="",
                )
                for a in actions
            ],
        )

    # -----------------------------------------------------------------------
    # Connection CRUD handlers (REST)
    # -----------------------------------------------------------------------

    @intercept_exceptions()
    async def list_connections(
        self,
        request: Request,
        provider_key: str,
        integration_key: str,
    ) -> ConnectionsListResponse:
        connections = await self.tools_service.list_connections(
            project_id=UUID(request.state.project_id),
            provider_key=provider_key,
            integration_key=integration_key,
        )
        return ConnectionsListResponse(
            count=len(connections),
            connections=[
                ConnectionItem(
                    slug=c.slug,
                    name=c.name,
                    description=c.description,
                    is_active=c.is_active,
                    is_valid=c.is_valid,
                    status=c.status,
                    created_at=c.created_at,
                    updated_at=c.updated_at,
                )
                for c in connections
            ],
        )

    @intercept_exceptions()
    async def create_connection(
        self,
        request: Request,
        provider_key: str,
        integration_key: str,
        *,
        body: ConnectionCreateRequest,
    ) -> ConnectionResponse:
        result = await self.tools_service.create_connection(
            project_id=UUID(request.state.project_id),
            user_id=UUID(request.state.user_id),
            #
            provider_key=provider_key,
            integration_key=integration_key,
            #
            connection_create=ConnectionCreate(
                slug=body.slug,
                name=body.name,
                description=body.description,
                mode=body.mode,
                callback_url=body.callback_url,
                credentials=body.credentials,
            ),
        )

        return ConnectionResponse(
            connection=ConnectionItem(
                slug=result.connection.slug,
                name=result.connection.name,
                description=result.connection.description,
                is_active=result.connection.is_active,
                is_valid=result.connection.is_valid,
                status=result.connection.status,
                created_at=result.connection.created_at,
                updated_at=result.connection.updated_at,
            ),
            redirect_url=result.redirect_url,
        )

    @intercept_exceptions()
    async def get_connection(
        self,
        request: Request,
        provider_key: str,
        integration_key: str,
        connection_slug: str,
    ) -> ConnectionItem:
        conn = await self.tools_service.get_connection(
            project_id=UUID(request.state.project_id),
            provider_key=provider_key,
            integration_key=integration_key,
            connection_slug=connection_slug,
        )
        if not conn:
            return JSONResponse(
                status_code=404, content={"detail": "Connection not found"}
            )

        return ConnectionItem(
            slug=conn.slug,
            name=conn.name,
            description=conn.description,
            is_active=conn.is_active,
            is_valid=conn.is_valid,
            status=conn.status,
            created_at=conn.created_at,
            updated_at=conn.updated_at,
        )

    @intercept_exceptions()
    async def delete_connection(
        self,
        request: Request,
        provider_key: str,
        integration_key: str,
        connection_slug: str,
    ) -> None:
        await self.tools_service.delete_connection(
            project_id=UUID(request.state.project_id),
            provider_key=provider_key,
            integration_key=integration_key,
            connection_slug=connection_slug,
        )

    @intercept_exceptions()
    async def refresh_connection_rest(
        self,
        request: Request,
        provider_key: str,
        integration_key: str,
        connection_slug: str,
    ) -> RefreshResponse:
        result = await self.tools_service.refresh_connection(
            project_id=UUID(request.state.project_id),
            provider_key=provider_key,
            integration_key=integration_key,
            connection_slug=connection_slug,
        )
        return RefreshResponse(
            connection=ConnectionItem(
                slug=result.connection.slug,
                name=result.connection.name,
                is_active=result.connection.is_active,
                is_valid=result.connection.is_valid,
                status=result.connection.status,
            ),
            redirect_url=result.redirect_url,
        )

    # -----------------------------------------------------------------------
    # Slug-based operation handlers
    # -----------------------------------------------------------------------

    @intercept_exceptions()
    async def query_tools(
        self,
        request: Request,
        *,
        query_request_params: Optional[ToolQueryRequest] = Depends(
            parse_tool_query_request_from_params
        ),
    ) -> ToolsResponse:
        body_json = None
        query_request_body = None

        try:
            body_json = await request.json()
            if body_json:
                query_request_body = ToolQueryRequest(**body_json)
        except Exception:
            pass

        merged = merge_tool_query_requests(
            query_request_params,
            query_request_body,
        )

        tool_query = None
        if merged.tool:
            flags = None
            if merged.tool.flags:
                from oss.src.core.tools.dtos import ToolQueryFlags

                flags = ToolQueryFlags(
                    is_connected=merged.tool.flags.is_connected,
                )

            tool_query = ToolQuery(
                name=merged.tool.name,
                description=merged.tool.description,
                provider_key=merged.tool.provider_key,
                integration_key=merged.tool.integration_key,
                tags=merged.tool.tags,
                flags=flags,
            )

        tools, count = await self.tools_service.query_tools(
            project_id=UUID(request.state.project_id),
            #
            tool_query=tool_query,
            #
            include_connections=merged.include_connections,
            #
            windowing=merged.windowing,
        )

        return ToolsResponse(
            count=count,
            tools=[ToolResult(**t) for t in tools],
        )

    @intercept_exceptions()
    async def connect(
        self,
        request: Request,
        *,
        body: ConnectRequest,
    ) -> ConnectionResponse:
        parsed = parse_tool_slug(body.slug)

        result = await self.tools_service.create_connection(
            project_id=UUID(request.state.project_id),
            user_id=UUID(request.state.user_id),
            #
            provider_key=parsed.provider_key,
            integration_key=parsed.integration_key,
            #
            connection_create=ConnectionCreate(
                slug=body.connection_slug,
                name=body.name,
                mode=body.mode,
                callback_url=body.callback_url,
                credentials=body.credentials,
            ),
        )

        return ConnectionResponse(
            connection=ConnectionItem(
                slug=result.connection.slug,
                name=result.connection.name,
                is_active=result.connection.is_active,
                is_valid=result.connection.is_valid,
                status=result.connection.status,
                created_at=result.connection.created_at,
            ),
            redirect_url=result.redirect_url,
        )

    @intercept_exceptions()
    async def refresh(
        self,
        request: Request,
        *,
        body: RefreshRequest,
    ) -> RefreshResponse:
        parsed = parse_tool_slug(body.slug)

        # For refresh, the slug is tools.{provider}.{integration}.{connection_slug}
        result = await self.tools_service.refresh_connection(
            project_id=UUID(request.state.project_id),
            provider_key=parsed.provider_key,
            integration_key=parsed.integration_key,
            connection_slug=parsed.action_key,  # action_key position holds connection_slug
            force=body.force,
        )

        return RefreshResponse(
            connection=ConnectionItem(
                slug=result.connection.slug,
                name=result.connection.name,
                is_active=result.connection.is_active,
                is_valid=result.connection.is_valid,
                status=result.connection.status,
            ),
            redirect_url=result.redirect_url,
        )

    @intercept_exceptions()
    async def inspect(
        self,
        request: Request,
    ) -> JSONResponse:
        return JSONResponse(
            status_code=501,
            content={"detail": "Not implemented"},
        )

    @intercept_exceptions()
    async def invoke(
        self,
        request: Request,
    ) -> JSONResponse:
        return JSONResponse(
            status_code=501,
            content={"detail": "Not implemented"},
        )

    @intercept_exceptions()
    async def oauth_callback(
        self,
        request: Request,
        *,
        state: Optional[str] = None,
        code: Optional[str] = None,
        error: Optional[str] = None,
    ) -> HTMLResponse:
        if error:
            return HTMLResponse(
                content=f"""<html><body><script>
window.opener.postMessage({{ type: "tools:oauth:complete", status: "error", error: "{error}" }}, "*");
window.close();
</script></body></html>"""
            )

        # TODO: verify state token, exchange code, mark connection as valid

        return HTMLResponse(
            content="""<html><body><script>
window.opener.postMessage({ type: "tools:oauth:complete", status: "success" }, "*");
window.close();
</script></body></html>"""
        )
