from functools import wraps
from typing import Optional
from uuid import UUID

import httpx
from fastapi import APIRouter, HTTPException, Query, Request, status
from fastapi.responses import JSONResponse

from oss.src.utils.exceptions import intercept_exceptions
from oss.src.utils.logging import get_module_logger
from oss.src.utils.caching import get_cache, set_cache
from oss.src.utils.common import is_ee

from oss.src.apis.fastapi.triggers.models import (
    TriggerCatalogEventResponse,
    TriggerCatalogEventsResponse,
    TriggerCatalogProviderResponse,
    TriggerCatalogProvidersResponse,
    TriggerDeliveriesResponse,
    TriggerDeliveryQueryRequest,
    TriggerDeliveryResponse,
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
    SubscriptionNotFoundError,
)
from oss.src.core.triggers.service import TriggersService


if is_ee():
    from ee.src.core.access.permissions.types import Permission
    from ee.src.core.access.permissions.service import (
        check_action_access,
        FORBIDDEN_EXCEPTION,
    )

log = get_module_logger(__name__)


def handle_adapter_exceptions():
    """Map unknown providers to 404 and upstream 401 failures to 424."""

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


class TriggersRouter:
    def __init__(
        self,
        *,
        triggers_service: TriggersService,
    ):
        self.triggers_service = triggers_service

        self.router = APIRouter()

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
    # Trigger Catalog
    # -----------------------------------------------------------------------

    @intercept_exceptions()
    @handle_adapter_exceptions()
    async def list_providers(
        self,
        request: Request,
    ) -> TriggerCatalogProvidersResponse:
        if is_ee():
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
        if is_ee():
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
        if is_ee():
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

        events, next_cursor, total = await self.triggers_service.list_events(
            provider_key=provider_key,
            integration_key=integration_key,
            query=query,
            limit=limit,
            cursor=cursor,
        )
        items = list(events)

        response = TriggerCatalogEventsResponse(
            count=len(items),
            total=total,
            cursor=next_cursor,
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
        if is_ee():
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
        if is_ee():
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
        await self._check(request, Permission.EDIT_TRIGGERS if is_ee() else None)

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
    async def list_subscriptions(
        self,
        request: Request,
    ) -> TriggerSubscriptionsResponse:
        await self._check(request, Permission.VIEW_TRIGGERS if is_ee() else None)

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
        await self._check(request, Permission.VIEW_TRIGGERS if is_ee() else None)

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
        await self._check(request, Permission.VIEW_TRIGGERS if is_ee() else None)

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
        await self._check(request, Permission.EDIT_TRIGGERS if is_ee() else None)

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
        await self._check(request, Permission.EDIT_TRIGGERS if is_ee() else None)

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
        await self._check(request, Permission.EDIT_TRIGGERS if is_ee() else None)

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
        await self._check(request, Permission.EDIT_TRIGGERS if is_ee() else None)

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

    # -----------------------------------------------------------------------
    # Trigger Deliveries
    # -----------------------------------------------------------------------

    @intercept_exceptions()
    async def list_deliveries(
        self,
        request: Request,
    ) -> TriggerDeliveriesResponse:
        await self._check(request, Permission.VIEW_TRIGGERS if is_ee() else None)

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
        await self._check(request, Permission.VIEW_TRIGGERS if is_ee() else None)

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
        await self._check(request, Permission.VIEW_TRIGGERS if is_ee() else None)

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
