import asyncio
from datetime import datetime, timedelta
from functools import wraps
from json import JSONDecodeError, loads
from typing import Any, Optional
from uuid import UUID

import httpx
from fastapi import APIRouter, HTTPException, Query, Request, status
from fastapi.responses import JSONResponse

from oss.src.utils.exceptions import intercept_exceptions
from oss.src.utils.logging import get_module_logger
from oss.src.utils.caching import get_cache, set_cache

from oss.src.apis.fastapi.triggers.models import (
    TriggerCatalogEventResponse,
    TriggerCatalogEventsResponse,
    TriggerCatalogIntegrationResponse,
    TriggerCatalogIntegrationsResponse,
    TriggerCatalogProviderResponse,
    TriggerCatalogProvidersResponse,
    TriggerConnectionCreateRequest,
    TriggerConnectionResponse,
    TriggerConnectionsResponse,
    TriggerDeliveriesResponse,
    TriggerDeliveryQueryRequest,
    TriggerDeliveryResponse,
    TriggerEventAck,
    TriggerScheduleCreateRequest,
    TriggerScheduleEditRequest,
    TriggerScheduleQueryRequest,
    TriggerScheduleResponse,
    TriggerSchedulesResponse,
    TriggerSubscriptionCreateRequest,
    TriggerSubscriptionEditRequest,
    TriggerSubscriptionQueryRequest,
    TriggerSubscriptionResponse,
    TriggerSubscriptionsResponse,
)
from oss.src.core.triggers.exceptions import (
    AdapterError,
    ConnectionNotFoundError,
    ProviderNotFoundError,
    ScheduleNotFoundError,
    SubscriptionNotFoundError,
    TriggerReferenceInvalid,
    TriggerScheduleInvalid,
)
from oss.src.core.triggers.service import TriggersService


from oss.src.core.access.permissions.types import Permission
from oss.src.core.access.permissions.service import check_action_access
from oss.src.apis.fastapi.shared.exceptions import FORBIDDEN_EXCEPTION

log = get_module_logger(__name__)

_ENQUEUE_TIMEOUT_SECONDS = 5.0


def handle_adapter_exceptions():
    """Map provider/adapter failures to HTTP, surfacing the upstream detail.

    Unknown providers → 404. Any upstream failure (Composio 4xx such as a
    rejected ``trigger_config``, or a malformed response) → 424 carrying the
    provider's own message so the client can show it instead of a generic 500.
    A true upstream 5xx → 502.
    """

    def decorator(func):
        @wraps(func)
        async def wrapper(*args, **kwargs):
            try:
                return await func(*args, **kwargs)
            except ProviderNotFoundError as e:
                raise HTTPException(
                    status_code=status.HTTP_404_NOT_FOUND,
                    detail=str(e),
                ) from e
            except AdapterError as e:
                detail = e.detail or e.message
                cause = e.__cause__
                upstream_status = (
                    cause.response.status_code
                    if isinstance(cause, httpx.HTTPStatusError)
                    and cause.response is not None
                    else None
                )
                if upstream_status is not None and upstream_status >= 500:
                    raise HTTPException(
                        status_code=status.HTTP_502_BAD_GATEWAY,
                        detail=detail,
                    ) from e
                raise HTTPException(
                    status_code=status.HTTP_424_FAILED_DEPENDENCY,
                    detail=detail,
                ) from e

        return wrapper

    return decorator


class TriggersRouter:
    def __init__(
        self,
        *,
        triggers_service: TriggersService,
        dispatch_task: Optional[Any] = None,
    ):
        self.triggers_service = triggers_service
        self.dispatch_task = dispatch_task

        self.router = APIRouter()

        # --- Trigger Ingress (inbound provider events) ---
        self.router.add_api_route(
            "/composio/events/",
            self.ingest_composio_event,
            methods=["POST"],
            operation_id="ingest_composio_event",
            response_model=TriggerEventAck,
            status_code=status.HTTP_202_ACCEPTED,
        )

        # --- Trigger Catalog ---
        self.router.add_api_route(
            "/catalog/providers/",
            self.list_providers,
            methods=["GET"],
            operation_id="list_trigger_providers",
            response_model=TriggerCatalogProvidersResponse,
            response_model_exclude_none=True,
        )
        self.router.add_api_route(
            "/catalog/providers/{provider_key}",
            self.get_provider,
            methods=["GET"],
            operation_id="fetch_trigger_provider",
            response_model=TriggerCatalogProviderResponse,
            response_model_exclude_none=True,
        )
        self.router.add_api_route(
            "/catalog/providers/{provider_key}/integrations/",
            self.list_integrations,
            methods=["GET"],
            operation_id="list_trigger_integrations",
            response_model=TriggerCatalogIntegrationsResponse,
            response_model_exclude_none=True,
        )
        self.router.add_api_route(
            "/catalog/providers/{provider_key}/integrations/{integration_key}",
            self.get_integration,
            methods=["GET"],
            operation_id="fetch_trigger_integration",
            response_model=TriggerCatalogIntegrationResponse,
            response_model_exclude_none=True,
        )
        self.router.add_api_route(
            "/catalog/providers/{provider_key}/integrations/{integration_key}/events/",
            self.list_events,
            methods=["GET"],
            operation_id="list_trigger_events",
            response_model=TriggerCatalogEventsResponse,
            response_model_exclude_none=True,
        )
        self.router.add_api_route(
            "/catalog/providers/{provider_key}/integrations/{integration_key}/events/{event_key}",
            self.get_event,
            methods=["GET"],
            operation_id="fetch_trigger_event",
            response_model=TriggerCatalogEventResponse,
            response_model_exclude_none=True,
        )

        # --- Trigger Connections ---
        # Shared `gateway_connections` rows; independent surface from tools.
        self.router.add_api_route(
            "/connections/query",
            self.query_connections,
            methods=["POST"],
            operation_id="query_trigger_connections",
            response_model=TriggerConnectionsResponse,
            response_model_exclude_none=True,
        )
        self.router.add_api_route(
            "/connections/",
            self.create_connection,
            methods=["POST"],
            operation_id="create_trigger_connection",
            response_model=TriggerConnectionResponse,
            response_model_exclude_none=True,
        )
        self.router.add_api_route(
            "/connections/{connection_id}",
            self.get_connection,
            methods=["GET"],
            operation_id="fetch_trigger_connection",
            response_model=TriggerConnectionResponse,
            response_model_exclude_none=True,
        )
        self.router.add_api_route(
            "/connections/{connection_id}",
            self.delete_connection,
            methods=["DELETE"],
            operation_id="delete_trigger_connection",
            status_code=status.HTTP_204_NO_CONTENT,
        )
        self.router.add_api_route(
            "/connections/{connection_id}/refresh",
            self.refresh_connection,
            methods=["POST"],
            operation_id="refresh_trigger_connection",
            response_model=TriggerConnectionResponse,
            response_model_exclude_none=True,
        )
        self.router.add_api_route(
            "/connections/{connection_id}/revoke",
            self.revoke_connection,
            methods=["POST"],
            operation_id="revoke_trigger_connection",
            response_model=TriggerConnectionResponse,
            response_model_exclude_none=True,
        )

        # --- Trigger Subscriptions ---
        self.router.add_api_route(
            "/subscriptions/",
            self.create_subscription,
            methods=["POST"],
            operation_id="create_trigger_subscription",
            response_model=TriggerSubscriptionResponse,
            response_model_exclude_none=True,
            status_code=status.HTTP_200_OK,
        )
        self.router.add_api_route(
            "/subscriptions/",
            self.list_subscriptions,
            methods=["GET"],
            operation_id="list_trigger_subscriptions",
            response_model=TriggerSubscriptionsResponse,
            response_model_exclude_none=True,
            status_code=status.HTTP_200_OK,
        )
        self.router.add_api_route(
            "/subscriptions/query",
            self.query_subscriptions,
            methods=["POST"],
            operation_id="query_trigger_subscriptions",
            response_model=TriggerSubscriptionsResponse,
            response_model_exclude_none=True,
            status_code=status.HTTP_200_OK,
        )
        self.router.add_api_route(
            "/subscriptions/test",
            self.test_subscription,
            methods=["POST"],
            operation_id="test_trigger_subscription",
            response_model=TriggerDeliveryResponse,
            response_model_exclude_none=True,
            status_code=status.HTTP_200_OK,
        )
        self.router.add_api_route(
            "/subscriptions/{subscription_id}/refresh",
            self.refresh_subscription,
            methods=["POST"],
            operation_id="refresh_trigger_subscription",
            response_model=TriggerSubscriptionResponse,
            response_model_exclude_none=True,
            status_code=status.HTTP_200_OK,
        )
        self.router.add_api_route(
            "/subscriptions/{subscription_id}/revoke",
            self.revoke_subscription,
            methods=["POST"],
            operation_id="revoke_trigger_subscription",
            response_model=TriggerSubscriptionResponse,
            response_model_exclude_none=True,
            status_code=status.HTTP_200_OK,
        )
        self.router.add_api_route(
            "/subscriptions/{subscription_id}/start",
            self.start_subscription,
            methods=["POST"],
            operation_id="start_trigger_subscription",
            response_model=TriggerSubscriptionResponse,
            response_model_exclude_none=True,
            status_code=status.HTTP_200_OK,
        )
        self.router.add_api_route(
            "/subscriptions/{subscription_id}/stop",
            self.stop_subscription,
            methods=["POST"],
            operation_id="stop_trigger_subscription",
            response_model=TriggerSubscriptionResponse,
            response_model_exclude_none=True,
            status_code=status.HTTP_200_OK,
        )
        self.router.add_api_route(
            "/subscriptions/{subscription_id}",
            self.fetch_subscription,
            methods=["GET"],
            operation_id="fetch_trigger_subscription",
            response_model=TriggerSubscriptionResponse,
            response_model_exclude_none=True,
            status_code=status.HTTP_200_OK,
        )
        self.router.add_api_route(
            "/subscriptions/{subscription_id}",
            self.edit_subscription,
            methods=["PUT"],
            operation_id="edit_trigger_subscription",
            response_model=TriggerSubscriptionResponse,
            response_model_exclude_none=True,
            status_code=status.HTTP_200_OK,
        )
        self.router.add_api_route(
            "/subscriptions/{subscription_id}",
            self.delete_subscription,
            methods=["DELETE"],
            operation_id="delete_trigger_subscription",
            status_code=status.HTTP_204_NO_CONTENT,
        )

        # --- Trigger Schedules ---
        self.router.add_api_route(
            "/schedules/",
            self.create_schedule,
            methods=["POST"],
            operation_id="create_trigger_schedule",
            response_model=TriggerScheduleResponse,
            response_model_exclude_none=True,
            status_code=status.HTTP_200_OK,
        )
        self.router.add_api_route(
            "/schedules/",
            self.list_schedules,
            methods=["GET"],
            operation_id="list_trigger_schedules",
            response_model=TriggerSchedulesResponse,
            response_model_exclude_none=True,
            status_code=status.HTTP_200_OK,
        )
        self.router.add_api_route(
            "/schedules/query",
            self.query_schedules,
            methods=["POST"],
            operation_id="query_trigger_schedules",
            response_model=TriggerSchedulesResponse,
            response_model_exclude_none=True,
            status_code=status.HTTP_200_OK,
        )
        self.router.add_api_route(
            "/schedules/{schedule_id}",
            self.fetch_schedule,
            methods=["GET"],
            operation_id="fetch_trigger_schedule",
            response_model=TriggerScheduleResponse,
            response_model_exclude_none=True,
            status_code=status.HTTP_200_OK,
        )
        self.router.add_api_route(
            "/schedules/{schedule_id}",
            self.edit_schedule,
            methods=["PUT"],
            operation_id="edit_trigger_schedule",
            response_model=TriggerScheduleResponse,
            response_model_exclude_none=True,
            status_code=status.HTTP_200_OK,
        )
        self.router.add_api_route(
            "/schedules/{schedule_id}",
            self.delete_schedule,
            methods=["DELETE"],
            operation_id="delete_trigger_schedule",
            status_code=status.HTTP_204_NO_CONTENT,
        )
        self.router.add_api_route(
            "/schedules/{schedule_id}/start",
            self.start_schedule,
            methods=["POST"],
            operation_id="start_trigger_schedule",
            response_model=TriggerScheduleResponse,
            response_model_exclude_none=True,
            status_code=status.HTTP_200_OK,
        )
        self.router.add_api_route(
            "/schedules/{schedule_id}/stop",
            self.stop_schedule,
            methods=["POST"],
            operation_id="stop_trigger_schedule",
            response_model=TriggerScheduleResponse,
            response_model_exclude_none=True,
            status_code=status.HTTP_200_OK,
        )

        # --- Trigger Schedules (admin) ---
        # The cron driver POSTs to /admin/triggers/schedules/refresh (mounted in
        # entrypoints/routers.py under prefix /admin/triggers). No auth/entitlement.
        self.admin_router = APIRouter()
        self.admin_router.add_api_route(
            "/schedules/refresh",
            self.refresh_schedules,
            methods=["POST"],
            operation_id="refresh_trigger_schedules",
        )

        # --- Trigger Deliveries ---
        self.router.add_api_route(
            "/deliveries",
            self.list_deliveries,
            methods=["GET"],
            operation_id="list_trigger_deliveries",
            response_model=TriggerDeliveriesResponse,
            response_model_exclude_none=True,
            status_code=status.HTTP_200_OK,
        )
        self.router.add_api_route(
            "/deliveries/query",
            self.query_deliveries,
            methods=["POST"],
            operation_id="query_trigger_deliveries",
            response_model=TriggerDeliveriesResponse,
            response_model_exclude_none=True,
            status_code=status.HTTP_200_OK,
        )
        self.router.add_api_route(
            "/deliveries/{delivery_id}",
            self.fetch_delivery,
            methods=["GET"],
            operation_id="fetch_trigger_delivery",
            response_model=TriggerDeliveryResponse,
            response_model_exclude_none=True,
            status_code=status.HTTP_200_OK,
        )

    # -----------------------------------------------------------------------
    # Trigger Connections
    #
    # Independent surface over the SAME shared ConnectionsService that tools
    # uses; both read/write the `gateway_connections` rows, so a connection
    # made from either side is visible from both. The OAuth callback stays on
    # `/tools/connections/callback` by design (shared public contract).
    # -----------------------------------------------------------------------

    @intercept_exceptions()
    async def query_connections(
        self,
        request: Request,
        *,
        provider_key: Optional[str] = Query(default=None),
        integration_key: Optional[str] = Query(default=None),
    ) -> TriggerConnectionsResponse:
        has_permission = await check_action_access(
            user_uid=request.state.user_id,
            project_id=request.state.project_id,
            permission=Permission.VIEW_TRIGGERS,
        )
        if not has_permission:
            raise FORBIDDEN_EXCEPTION

        connections = await self.triggers_service.query_connections(
            project_id=UUID(request.state.project_id),
            provider_key=provider_key,
            integration_key=integration_key,
        )
        return TriggerConnectionsResponse(
            count=len(connections),
            connections=connections,
        )

    @intercept_exceptions()
    async def create_connection(
        self,
        request: Request,
        *,
        body: TriggerConnectionCreateRequest,
    ) -> TriggerConnectionResponse:
        has_permission = await check_action_access(
            user_uid=request.state.user_id,
            project_id=request.state.project_id,
            permission=Permission.EDIT_TRIGGERS,
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

        connection = await self.triggers_service.create_connection(
            project_id=UUID(request.state.project_id),
            user_id=UUID(request.state.user_id),
            #
            connection_create=body.connection,
        )

        return TriggerConnectionResponse(
            count=1,
            connection=connection,
        )

    @intercept_exceptions()
    async def get_connection(
        self,
        request: Request,
        connection_id: UUID,
    ) -> TriggerConnectionResponse:
        has_permission = await check_action_access(
            user_uid=request.state.user_id,
            project_id=request.state.project_id,
            permission=Permission.VIEW_TRIGGERS,
        )
        if not has_permission:
            raise FORBIDDEN_EXCEPTION

        connection = await self.triggers_service.get_connection(
            project_id=UUID(request.state.project_id),
            connection_id=connection_id,
        )
        if not connection:
            return JSONResponse(
                status_code=404,
                content={"detail": "Connection not found"},
            )

        return TriggerConnectionResponse(
            count=1,
            connection=connection,
        )

    @intercept_exceptions()
    async def delete_connection(
        self,
        request: Request,
        connection_id: UUID,
    ) -> None:
        has_permission = await check_action_access(
            user_uid=request.state.user_id,
            project_id=request.state.project_id,
            permission=Permission.EDIT_TRIGGERS,
        )
        if not has_permission:
            raise FORBIDDEN_EXCEPTION

        await self.triggers_service.delete_connection(
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
    ) -> TriggerConnectionResponse:
        has_permission = await check_action_access(
            user_uid=request.state.user_id,
            project_id=request.state.project_id,
            permission=Permission.EDIT_TRIGGERS,
        )
        if not has_permission:
            raise FORBIDDEN_EXCEPTION

        connection = await self.triggers_service.refresh_connection(
            project_id=UUID(request.state.project_id),
            connection_id=connection_id,
            force=force,
        )

        return TriggerConnectionResponse(
            count=1,
            connection=connection,
        )

    @intercept_exceptions()
    async def revoke_connection(
        self,
        request: Request,
        connection_id: UUID,
    ) -> TriggerConnectionResponse:
        has_permission = await check_action_access(
            user_uid=request.state.user_id,
            project_id=request.state.project_id,
            permission=Permission.EDIT_TRIGGERS,
        )
        if not has_permission:
            raise FORBIDDEN_EXCEPTION

        connection = await self.triggers_service.revoke_connection(
            project_id=UUID(request.state.project_id),
            connection_id=connection_id,
        )

        return TriggerConnectionResponse(
            count=1,
            connection=connection,
        )

    # -----------------------------------------------------------------------
    # Trigger Catalog
    # -----------------------------------------------------------------------

    @intercept_exceptions()
    @handle_adapter_exceptions()
    async def list_providers(
        self,
        request: Request,
    ) -> TriggerCatalogProvidersResponse:
        has_permission = await check_action_access(
            project_id=request.state.project_id,
            user_uid=request.state.user_id,
            permission=Permission.VIEW_TRIGGERS,
        )
        if not has_permission:
            raise FORBIDDEN_EXCEPTION

        cached = await get_cache(
            project_id=None,  # catalog is global; not per-project
            namespace="triggers:catalog:providers",
            key={},
            model=TriggerCatalogProvidersResponse,
        )
        if cached:
            return cached

        providers = await self.triggers_service.list_providers()
        items = list(providers)

        response = TriggerCatalogProvidersResponse(
            count=len(items),
            providers=items,
        )

        await set_cache(
            project_id=None,
            namespace="triggers:catalog:providers",
            key={},
            value=response,
            ttl=5 * 60,
        )

        return response

    @intercept_exceptions()
    @handle_adapter_exceptions()
    async def get_provider(
        self,
        request: Request,
        provider_key: str,
    ) -> TriggerCatalogProviderResponse:
        has_permission = await check_action_access(
            user_uid=request.state.user_id,
            project_id=request.state.project_id,
            permission=Permission.VIEW_TRIGGERS,
        )
        if not has_permission:
            raise FORBIDDEN_EXCEPTION

        cache_key = {"provider_key": provider_key}
        cached = await get_cache(
            project_id=None,
            namespace="triggers:catalog:provider",
            key=cache_key,
            model=TriggerCatalogProviderResponse,
        )
        if cached:
            return cached

        provider = await self.triggers_service.get_provider(
            provider_key=provider_key,
        )
        if not provider:
            return JSONResponse(
                status_code=404,
                content={"detail": "Provider not found"},
            )

        response = TriggerCatalogProviderResponse(
            count=1,
            provider=provider,
        )

        await set_cache(
            project_id=None,
            namespace="triggers:catalog:provider",
            key=cache_key,
            value=response,
            ttl=5 * 60,
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
    ) -> TriggerCatalogIntegrationsResponse:
        has_permission = await check_action_access(
            user_uid=request.state.user_id,
            project_id=request.state.project_id,
            permission=Permission.VIEW_TRIGGERS,
        )
        if not has_permission:
            raise FORBIDDEN_EXCEPTION

        cache_key = {
            "provider_key": provider_key,
            "search": search,
            "sort_by": sort_by,
            "limit": limit,
            "cursor": cursor,
        }
        cached = await get_cache(
            project_id=None,
            namespace="triggers:catalog:integrations",
            key=cache_key,
            model=TriggerCatalogIntegrationsResponse,
        )
        if cached:
            return cached

        page = await self.triggers_service.list_integrations(
            provider_key=provider_key,
            search=search,
            sort_by=sort_by,
            limit=limit,
            cursor=cursor,
        )
        items = list(page.integrations)

        response = TriggerCatalogIntegrationsResponse(
            count=len(items),
            total=page.total,
            cursor=page.next_cursor,
            integrations=items,
        )

        await set_cache(
            project_id=None,
            namespace="triggers:catalog:integrations",
            key=cache_key,
            value=response,
            ttl=5 * 60,
        )

        return response

    @intercept_exceptions()
    @handle_adapter_exceptions()
    async def get_integration(
        self,
        request: Request,
        provider_key: str,
        integration_key: str,
    ) -> TriggerCatalogIntegrationResponse:
        has_permission = await check_action_access(
            user_uid=request.state.user_id,
            project_id=request.state.project_id,
            permission=Permission.VIEW_TRIGGERS,
        )
        if not has_permission:
            raise FORBIDDEN_EXCEPTION

        cache_key = {
            "provider_key": provider_key,
            "integration_key": integration_key,
        }
        cached = await get_cache(
            project_id=None,
            namespace="triggers:catalog:integration",
            key=cache_key,
            model=TriggerCatalogIntegrationResponse,
        )
        if cached:
            return cached

        integration = await self.triggers_service.get_integration(
            provider_key=provider_key,
            integration_key=integration_key,
        )
        if not integration:
            return JSONResponse(
                status_code=404,
                content={"detail": "Integration not found"},
            )

        response = TriggerCatalogIntegrationResponse(
            count=1,
            integration=integration,
        )

        await set_cache(
            project_id=None,
            namespace="triggers:catalog:integration",
            key=cache_key,
            value=response,
            ttl=5 * 60,
        )

        return response

    @intercept_exceptions()
    @handle_adapter_exceptions()
    async def list_events(
        self,
        request: Request,
        provider_key: str,
        integration_key: str,
        *,
        query: Optional[str] = Query(default=None),
        limit: Optional[int] = Query(default=None),
        cursor: Optional[str] = Query(default=None),
    ) -> TriggerCatalogEventsResponse:
        has_permission = await check_action_access(
            user_uid=request.state.user_id,
            project_id=request.state.project_id,
            permission=Permission.VIEW_TRIGGERS,
        )
        if not has_permission:
            raise FORBIDDEN_EXCEPTION

        cache_key = {
            "provider_key": provider_key,
            "integration_key": integration_key,
            "query": query,
            "limit": limit,
            "cursor": cursor,
        }
        cached = await get_cache(
            project_id=None,
            namespace="triggers:catalog:events",
            key=cache_key,
            model=TriggerCatalogEventsResponse,
        )
        if cached:
            return cached

        page = await self.triggers_service.list_events(
            provider_key=provider_key,
            integration_key=integration_key,
            query=query,
            limit=limit,
            cursor=cursor,
        )
        items = list(page.events)

        response = TriggerCatalogEventsResponse(
            count=len(items),
            total=page.total,
            cursor=page.next_cursor,
            events=items,
        )

        await set_cache(
            project_id=None,
            namespace="triggers:catalog:events",
            key=cache_key,
            value=response,
            ttl=5 * 60,
        )

        return response

    @intercept_exceptions()
    @handle_adapter_exceptions()
    async def get_event(
        self,
        request: Request,
        provider_key: str,
        integration_key: str,
        event_key: str,
    ) -> TriggerCatalogEventResponse:
        has_permission = await check_action_access(
            user_uid=request.state.user_id,
            project_id=request.state.project_id,
            permission=Permission.VIEW_TRIGGERS,
        )
        if not has_permission:
            raise FORBIDDEN_EXCEPTION

        cache_key = {
            "provider_key": provider_key,
            "integration_key": integration_key,
            "event_key": event_key,
        }
        cached = await get_cache(
            project_id=None,
            namespace="triggers:catalog:event",
            key=cache_key,
            model=TriggerCatalogEventResponse,
        )
        if cached:
            return cached

        event = await self.triggers_service.get_event(
            provider_key=provider_key,
            integration_key=integration_key,
            event_key=event_key,
        )
        if not event:
            return JSONResponse(
                status_code=404,
                content={"detail": "Event not found"},
            )

        response = TriggerCatalogEventResponse(
            count=1,
            event=event,
        )

        await set_cache(
            project_id=None,
            namespace="triggers:catalog:event",
            key=cache_key,
            value=response,
            ttl=5 * 60,
        )

        return response

    # -----------------------------------------------------------------------
    # Trigger Subscriptions
    # -----------------------------------------------------------------------

    async def _check(self, request: Request, permission) -> None:
        has_permission = await check_action_access(
            user_uid=str(request.state.user_id),
            project_id=str(request.state.project_id),
            permission=permission,
        )
        if not has_permission:
            raise FORBIDDEN_EXCEPTION

    @intercept_exceptions()
    @handle_adapter_exceptions()
    async def create_subscription(
        self,
        request: Request,
        *,
        body: TriggerSubscriptionCreateRequest,
    ) -> TriggerSubscriptionResponse:
        await self._check(request, Permission.EDIT_TRIGGERS)

        try:
            subscription = await self.triggers_service.create_subscription(
                project_id=UUID(request.state.project_id),
                user_id=UUID(str(request.state.user_id)),
                #
                subscription=body.subscription,
            )
        except ConnectionNotFoundError as e:
            raise HTTPException(status_code=404, detail=e.message) from e

        return TriggerSubscriptionResponse(
            count=1 if subscription else 0,
            subscription=subscription,
        )

    @intercept_exceptions()
    @handle_adapter_exceptions()
    async def test_subscription(
        self,
        request: Request,
        *,
        body: TriggerSubscriptionCreateRequest,
    ) -> TriggerDeliveryResponse:
        await self._check(request, Permission.EDIT_TRIGGERS)

        try:
            delivery = await self.triggers_service.test_subscription(
                project_id=UUID(request.state.project_id),
                user_id=UUID(str(request.state.user_id)),
                #
                subscription=body.subscription,
            )
        except ConnectionNotFoundError as e:
            raise HTTPException(status_code=404, detail=e.message) from e

        return TriggerDeliveryResponse(
            count=1 if delivery else 0,
            delivery=delivery,
        )

    @intercept_exceptions()
    async def list_subscriptions(
        self,
        request: Request,
    ) -> TriggerSubscriptionsResponse:
        await self._check(request, Permission.VIEW_TRIGGERS)

        subscriptions = await self.triggers_service.query_subscriptions(
            project_id=UUID(request.state.project_id),
        )

        return TriggerSubscriptionsResponse(
            count=len(subscriptions),
            subscriptions=subscriptions,
        )

    @intercept_exceptions()
    async def query_subscriptions(
        self,
        request: Request,
        *,
        body: TriggerSubscriptionQueryRequest,
    ) -> TriggerSubscriptionsResponse:
        await self._check(request, Permission.VIEW_TRIGGERS)

        subscriptions = await self.triggers_service.query_subscriptions(
            project_id=UUID(request.state.project_id),
            #
            subscription=body.subscription,
            #
            windowing=body.windowing,
        )

        return TriggerSubscriptionsResponse(
            count=len(subscriptions),
            subscriptions=subscriptions,
        )

    @intercept_exceptions()
    async def fetch_subscription(
        self,
        request: Request,
        *,
        subscription_id: UUID,
    ) -> TriggerSubscriptionResponse:
        await self._check(request, Permission.VIEW_TRIGGERS)

        subscription = await self.triggers_service.fetch_subscription(
            project_id=UUID(request.state.project_id),
            #
            subscription_id=subscription_id,
        )
        if not subscription:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Trigger subscription not found",
            )

        return TriggerSubscriptionResponse(
            count=1,
            subscription=subscription,
        )

    @intercept_exceptions()
    @handle_adapter_exceptions()
    async def edit_subscription(
        self,
        request: Request,
        *,
        subscription_id: UUID,
        body: TriggerSubscriptionEditRequest,
    ) -> TriggerSubscriptionResponse:
        await self._check(request, Permission.EDIT_TRIGGERS)

        if str(subscription_id) != str(body.subscription.id):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Path subscription_id does not match body id",
            )

        subscription = await self.triggers_service.edit_subscription(
            project_id=UUID(request.state.project_id),
            user_id=UUID(str(request.state.user_id)),
            #
            subscription=body.subscription,
        )
        if not subscription:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Trigger subscription not found",
            )

        return TriggerSubscriptionResponse(
            count=1,
            subscription=subscription,
        )

    @intercept_exceptions()
    @handle_adapter_exceptions()
    async def delete_subscription(
        self,
        request: Request,
        *,
        subscription_id: UUID,
    ) -> None:
        await self._check(request, Permission.EDIT_TRIGGERS)

        deleted = await self.triggers_service.delete_subscription(
            project_id=UUID(request.state.project_id),
            #
            subscription_id=subscription_id,
        )
        if not deleted:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Trigger subscription not found",
            )

    @intercept_exceptions()
    @handle_adapter_exceptions()
    async def refresh_subscription(
        self,
        request: Request,
        *,
        subscription_id: UUID,
    ) -> TriggerSubscriptionResponse:
        await self._check(request, Permission.EDIT_TRIGGERS)

        try:
            subscription = await self.triggers_service.refresh_subscription(
                project_id=UUID(request.state.project_id),
                user_id=UUID(str(request.state.user_id)),
                #
                subscription_id=subscription_id,
            )
        except SubscriptionNotFoundError as e:
            raise HTTPException(status_code=404, detail=e.message) from e

        return TriggerSubscriptionResponse(
            count=1,
            subscription=subscription,
        )

    @intercept_exceptions()
    @handle_adapter_exceptions()
    async def revoke_subscription(
        self,
        request: Request,
        *,
        subscription_id: UUID,
    ) -> TriggerSubscriptionResponse:
        await self._check(request, Permission.EDIT_TRIGGERS)

        try:
            subscription = await self.triggers_service.revoke_subscription(
                project_id=UUID(request.state.project_id),
                user_id=UUID(str(request.state.user_id)),
                #
                subscription_id=subscription_id,
            )
        except SubscriptionNotFoundError as e:
            raise HTTPException(status_code=404, detail=e.message) from e

        return TriggerSubscriptionResponse(
            count=1,
            subscription=subscription,
        )

    @intercept_exceptions()
    async def start_subscription(
        self,
        request: Request,
        *,
        subscription_id: UUID,
    ) -> TriggerSubscriptionResponse:
        return await self._set_subscription_active(
            request=request,
            subscription_id=subscription_id,
            is_active=True,
        )

    @intercept_exceptions()
    async def stop_subscription(
        self,
        request: Request,
        *,
        subscription_id: UUID,
    ) -> TriggerSubscriptionResponse:
        return await self._set_subscription_active(
            request=request,
            subscription_id=subscription_id,
            is_active=False,
        )

    async def _set_subscription_active(
        self,
        *,
        request: Request,
        subscription_id: UUID,
        is_active: bool,
    ) -> TriggerSubscriptionResponse:
        await self._check(request, Permission.EDIT_TRIGGERS)

        try:
            subscription = await self.triggers_service.set_subscription_active(
                project_id=UUID(request.state.project_id),
                user_id=UUID(str(request.state.user_id)),
                #
                subscription_id=subscription_id,
                is_active=is_active,
            )
        except SubscriptionNotFoundError as e:
            raise HTTPException(status_code=404, detail=e.message) from e

        return TriggerSubscriptionResponse(
            count=1,
            subscription=subscription,
        )

    # -----------------------------------------------------------------------
    # Trigger Schedules
    # -----------------------------------------------------------------------

    @intercept_exceptions()
    async def create_schedule(
        self,
        request: Request,
        *,
        body: TriggerScheduleCreateRequest,
    ) -> TriggerScheduleResponse:
        await self._check(request, Permission.EDIT_TRIGGERS)

        try:
            schedule = await self.triggers_service.create_schedule(
                project_id=UUID(request.state.project_id),
                user_id=UUID(str(request.state.user_id)),
                #
                schedule=body.schedule,
            )
        except TriggerScheduleInvalid as e:
            raise HTTPException(status_code=422, detail=e.message) from e
        except TriggerReferenceInvalid as e:
            raise HTTPException(status_code=422, detail=e.message) from e

        return TriggerScheduleResponse(
            count=1 if schedule else 0,
            schedule=schedule,
        )

    @intercept_exceptions()
    async def list_schedules(
        self,
        request: Request,
    ) -> TriggerSchedulesResponse:
        await self._check(request, Permission.VIEW_TRIGGERS)

        schedules = await self.triggers_service.query_schedules(
            project_id=UUID(request.state.project_id),
        )

        return TriggerSchedulesResponse(
            count=len(schedules),
            schedules=schedules,
        )

    @intercept_exceptions()
    async def query_schedules(
        self,
        request: Request,
        *,
        body: TriggerScheduleQueryRequest,
    ) -> TriggerSchedulesResponse:
        await self._check(request, Permission.VIEW_TRIGGERS)

        schedules = await self.triggers_service.query_schedules(
            project_id=UUID(request.state.project_id),
            #
            schedule=body.schedule,
            #
            windowing=body.windowing,
        )

        return TriggerSchedulesResponse(
            count=len(schedules),
            schedules=schedules,
        )

    @intercept_exceptions()
    async def fetch_schedule(
        self,
        request: Request,
        *,
        schedule_id: UUID,
    ) -> TriggerScheduleResponse:
        await self._check(request, Permission.VIEW_TRIGGERS)

        schedule = await self.triggers_service.fetch_schedule(
            project_id=UUID(request.state.project_id),
            #
            schedule_id=schedule_id,
        )
        if not schedule:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Trigger schedule not found",
            )

        return TriggerScheduleResponse(
            count=1,
            schedule=schedule,
        )

    @intercept_exceptions()
    async def edit_schedule(
        self,
        request: Request,
        *,
        schedule_id: UUID,
        body: TriggerScheduleEditRequest,
    ) -> TriggerScheduleResponse:
        await self._check(request, Permission.EDIT_TRIGGERS)

        if str(schedule_id) != str(body.schedule.id):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Path schedule_id does not match body id",
            )

        try:
            schedule = await self.triggers_service.edit_schedule(
                project_id=UUID(request.state.project_id),
                user_id=UUID(str(request.state.user_id)),
                #
                schedule=body.schedule,
            )
        except TriggerScheduleInvalid as e:
            raise HTTPException(status_code=422, detail=e.message) from e
        except TriggerReferenceInvalid as e:
            raise HTTPException(status_code=422, detail=e.message) from e

        if not schedule:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Trigger schedule not found",
            )

        return TriggerScheduleResponse(
            count=1,
            schedule=schedule,
        )

    @intercept_exceptions()
    async def delete_schedule(
        self,
        request: Request,
        *,
        schedule_id: UUID,
    ) -> None:
        await self._check(request, Permission.EDIT_TRIGGERS)

        deleted = await self.triggers_service.delete_schedule(
            project_id=UUID(request.state.project_id),
            #
            schedule_id=schedule_id,
        )
        if not deleted:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Trigger schedule not found",
            )

    @intercept_exceptions()
    async def start_schedule(
        self,
        request: Request,
        *,
        schedule_id: UUID,
    ) -> TriggerScheduleResponse:
        return await self._set_schedule_active(
            request=request,
            schedule_id=schedule_id,
            is_active=True,
        )

    @intercept_exceptions()
    async def stop_schedule(
        self,
        request: Request,
        *,
        schedule_id: UUID,
    ) -> TriggerScheduleResponse:
        return await self._set_schedule_active(
            request=request,
            schedule_id=schedule_id,
            is_active=False,
        )

    async def _set_schedule_active(
        self,
        *,
        request: Request,
        schedule_id: UUID,
        is_active: bool,
    ) -> TriggerScheduleResponse:
        await self._check(request, Permission.EDIT_TRIGGERS)

        try:
            schedule = await self.triggers_service.set_schedule_active(
                project_id=UUID(request.state.project_id),
                user_id=UUID(str(request.state.user_id)),
                #
                schedule_id=schedule_id,
                is_active=is_active,
            )
        except ScheduleNotFoundError as e:
            raise HTTPException(status_code=404, detail=e.message) from e

        return TriggerScheduleResponse(
            count=1,
            schedule=schedule,
        )

    @intercept_exceptions()
    async def refresh_schedules(
        self,
        *,
        trigger_interval: int = Query(1, ge=1, le=60),
        trigger_datetime: datetime = Query(None),
    ) -> Any:
        # ----------------------------------------------------------------------
        # THIS IS AN ADMIN ENDPOINT
        # NO CHECK FOR PERMISSIONS / ENTITLEMENTS
        # ----------------------------------------------------------------------

        if not trigger_datetime or not trigger_interval:
            return {"status": "error"}

        timestamp = trigger_datetime - timedelta(minutes=trigger_interval)

        check = await self.triggers_service.refresh_schedules(
            timestamp=timestamp,
            interval=trigger_interval,
        )

        if not check:
            return {"status": "failure"}

        return {"status": "success"}

    # -----------------------------------------------------------------------
    # Trigger Deliveries
    # -----------------------------------------------------------------------

    @intercept_exceptions()
    async def list_deliveries(
        self,
        request: Request,
    ) -> TriggerDeliveriesResponse:
        await self._check(request, Permission.VIEW_TRIGGERS)

        deliveries = await self.triggers_service.query_deliveries(
            project_id=UUID(request.state.project_id),
        )

        return TriggerDeliveriesResponse(
            count=len(deliveries),
            deliveries=deliveries,
        )

    @intercept_exceptions()
    async def query_deliveries(
        self,
        request: Request,
        *,
        body: TriggerDeliveryQueryRequest,
    ) -> TriggerDeliveriesResponse:
        await self._check(request, Permission.VIEW_TRIGGERS)

        deliveries = await self.triggers_service.query_deliveries(
            project_id=UUID(request.state.project_id),
            #
            delivery=body.delivery,
            #
            windowing=body.windowing,
        )

        return TriggerDeliveriesResponse(
            count=len(deliveries),
            deliveries=deliveries,
        )

    @intercept_exceptions()
    async def fetch_delivery(
        self,
        request: Request,
        *,
        delivery_id: UUID,
    ) -> TriggerDeliveryResponse:
        await self._check(request, Permission.VIEW_TRIGGERS)

        delivery = await self.triggers_service.fetch_delivery(
            project_id=UUID(request.state.project_id),
            #
            delivery_id=delivery_id,
        )
        if not delivery:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Trigger delivery not found",
            )

        return TriggerDeliveryResponse(
            count=1,
            delivery=delivery,
        )

    # -----------------------------------------------------------------------
    # Trigger Ingress (inbound provider events)
    # -----------------------------------------------------------------------

    @intercept_exceptions()
    async def ingest_composio_event(
        self,
        request: Request,
    ) -> Any:
        """Receive a Composio provider event; verify, demux, ack-fast, enqueue.

        Public (no Agenta auth) — mirrors the Stripe events receiver. Scope and
        attribution are recovered downstream from the resolved subscription row.
        """
        body = await request.body()

        if not await self.triggers_service.verify_signature(
            body=body, headers=request.headers
        ):
            return JSONResponse(
                status_code=status.HTTP_401_UNAUTHORIZED,
                content={"status": "error", "detail": "Signature verification failed"},
            )

        try:
            envelope = loads(body) if body else {}
        except JSONDecodeError:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Invalid payload",
            )

        metadata = envelope.get("metadata") or {}
        trigger_id = metadata.get("trigger_id") or metadata.get("nano_id")
        event_id = metadata.get("id")

        if not trigger_id or not event_id:
            # Nothing to route — accept (no-op) so the provider does not retry.
            return TriggerEventAck(
                status="accepted", detail="No trigger_id/id to route"
            )

        if self.dispatch_task is not None:
            try:
                await asyncio.wait_for(
                    self.dispatch_task.kiq(
                        trigger_id=str(trigger_id),
                        event_id=str(event_id),
                        event=envelope,
                    ),
                    timeout=_ENQUEUE_TIMEOUT_SECONDS,
                )
            except Exception as e:
                log.error("Failed to enqueue trigger event: %s", e)
                raise HTTPException(
                    status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                    detail="Failed to enqueue trigger event",
                ) from e

        return TriggerEventAck(status="accepted")
