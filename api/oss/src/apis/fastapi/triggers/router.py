from functools import wraps
from typing import Optional

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
)
from oss.src.core.triggers.exceptions import AdapterError
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
