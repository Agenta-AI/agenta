"""FastAPI router for webhooks endpoints."""

from uuid import UUID
from typing import List

from fastapi import APIRouter, Request, status, HTTPException
from fastapi.responses import JSONResponse

from oss.src.utils.common import is_ee
from oss.src.utils.exceptions import intercept_exceptions
from oss.src.utils.caching import get_cache, set_cache, invalidate_cache
from oss.src.core.webhooks.service import WebhooksService
from oss.src.core.webhooks.dtos import (
    CreateWebhookSubscriptionDTO,
    UpdateWebhookSubscriptionDTO,
    WebhookSubscriptionQueryDTO,
)
from oss.src.apis.fastapi.webhooks.models import (
    CreateWebhookSubscriptionRequest,
    UpdateWebhookSubscriptionRequest,
    WebhookSubscriptionResponse,
    WebhookSubscriptionQueryRequest,
    WebhookSubscriptionsResponse,
    TestWebhookRequest,
    TestWebhookResponse,
)

if is_ee():
    from ee.src.models.shared_models import Permission
    from ee.src.utils.permissions import check_action_access


class WebhooksRouter:
    def __init__(self, webhooks_service: WebhooksService):
        self.service = webhooks_service
        self.router = APIRouter()

        self.router.add_api_route(
            "/",
            self.create_subscription,
            methods=["POST"],
            operation_id="create_webhook_subscription",
            response_model=WebhookSubscriptionResponse,
        )
        self.router.add_api_route(
            "/",
            self.list_subscriptions,
            methods=["GET"],
            operation_id="list_webhook_subscriptions",
            response_model=List[WebhookSubscriptionResponse],
        )
        # /query and /test MUST be registered before /{subscription_id}
        self.router.add_api_route(
            "/query",
            self.query_subscriptions,
            methods=["POST"],
            operation_id="query_webhook_subscriptions",
            response_model=WebhookSubscriptionsResponse,
        )
        self.router.add_api_route(
            "/test",
            self.test_webhook,
            methods=["POST"],
            operation_id="test_webhook",
            response_model=TestWebhookResponse,
        )
        self.router.add_api_route(
            "/{subscription_id}",
            self.get_subscription,
            methods=["GET"],
            operation_id="get_webhook_subscription",
            response_model=WebhookSubscriptionResponse,
        )
        self.router.add_api_route(
            "/{subscription_id}",
            self.update_subscription,
            methods=["PUT"],
            operation_id="update_webhook_subscription",
            response_model=WebhookSubscriptionResponse,
        )
        self.router.add_api_route(
            "/{subscription_id}/archive",
            self.archive_subscription,
            methods=["POST"],
            operation_id="archive_webhook_subscription",
            response_model=WebhookSubscriptionResponse,
        )

    @intercept_exceptions()
    async def create_subscription(
        self, request: Request, body: CreateWebhookSubscriptionRequest
    ):
        if is_ee():
            has_permission = await check_action_access(
                user_uid=str(request.state.user_id),
                project_id=str(request.state.project_id),
                permission=Permission.EDIT_WEBHOOKS,
            )
            if not has_permission:
                return JSONResponse(
                    {"detail": "You do not have access to perform this action"},
                    status_code=status.HTTP_403_FORBIDDEN,
                )

        # Convert API request to DTO
        dto = CreateWebhookSubscriptionDTO(**body.model_dump())

        subscription_dto = await self.service.create_subscription(
            user_id=request.state.user_id,
            project_id=UUID(request.state.project_id),
            payload=dto,
        )

        await invalidate_cache(
            project_id=request.state.project_id,
            namespace="webhook_query_subscriptions",
        )

        # Convert DTO to API response
        return WebhookSubscriptionResponse(**subscription_dto.model_dump())

    @intercept_exceptions()
    async def list_subscriptions(self, request: Request):
        if is_ee():
            has_permission = await check_action_access(
                user_uid=str(request.state.user_id),
                project_id=str(request.state.project_id),
                permission=Permission.VIEW_WEBHOOKS,
            )
            if not has_permission:
                return JSONResponse(
                    {"detail": "You do not have access to perform this action"},
                    status_code=status.HTTP_403_FORBIDDEN,
                )

        subscription_dtos = await self.service.list_subscriptions(
            project_id=UUID(request.state.project_id),
        )

        return [
            WebhookSubscriptionResponse(**dto.model_dump()) for dto in subscription_dtos
        ]

    @intercept_exceptions()
    async def query_subscriptions(
        self, request: Request, body: WebhookSubscriptionQueryRequest
    ) -> WebhookSubscriptionsResponse:
        if is_ee():
            has_permission = await check_action_access(
                user_uid=str(request.state.user_id),
                project_id=str(request.state.project_id),
                permission=Permission.VIEW_WEBHOOKS,
            )
            if not has_permission:
                return JSONResponse(
                    {"detail": "You do not have access to perform this action"},
                    status_code=status.HTTP_403_FORBIDDEN,
                )

        # Build cache key: include all filter + pagination fields, exclude None values
        cache_key = {
            k: v
            for k, v in {
                "is_active": body.is_active,
                "events": (",".join(sorted(body.events)) if body.events else None),
                "created_after": (
                    body.created_after.isoformat() if body.created_after else None
                ),
                "created_before": (
                    body.created_before.isoformat() if body.created_before else None
                ),
                "sort_by": body.sort_by or "created_at",
                "sort_order": body.sort_order or "desc",
                "offset": body.offset,
                "limit": body.limit,
            }.items()
            if v is not None
        }

        cached = await get_cache(
            project_id=request.state.project_id,
            namespace="webhook_query_subscriptions",
            key=cache_key,
            model=WebhookSubscriptionsResponse,
            retry=False,
        )

        if cached is not None:
            return cached

        filters = WebhookSubscriptionQueryDTO(
            is_active=body.is_active,
            events=body.events,
            created_after=body.created_after,
            created_before=body.created_before,
            sort_by=body.sort_by or "created_at",
            sort_order=body.sort_order or "desc",
        )

        subscriptions, total = await self.service.query_subscriptions(
            project_id=UUID(request.state.project_id),
            filters=filters,
            offset=body.offset,
            limit=body.limit,
        )

        data = [
            WebhookSubscriptionResponse(**dto.model_dump()) for dto in subscriptions
        ]

        response = WebhookSubscriptionsResponse(
            count=total,
            data=data,
            offset=body.offset,
            limit=body.limit,
        )

        await set_cache(
            project_id=request.state.project_id,
            namespace="webhook_query_subscriptions",
            key=cache_key,
            value=response,
        )

        return response

    @intercept_exceptions()
    async def get_subscription(self, request: Request, subscription_id: UUID):
        if is_ee():
            has_permission = await check_action_access(
                user_uid=str(request.state.user_id),
                project_id=str(request.state.project_id),
                permission=Permission.VIEW_WEBHOOKS,
            )
            if not has_permission:
                return JSONResponse(
                    {"detail": "You do not have access to perform this action"},
                    status_code=status.HTTP_403_FORBIDDEN,
                )

        subscription_dto = await self.service.get_subscription(
            subscription_id=subscription_id,
            project_id=UUID(request.state.project_id),
        )
        if not subscription_dto:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Webhook subscription not found",
            )

        return WebhookSubscriptionResponse(**subscription_dto.model_dump())

    @intercept_exceptions()
    async def update_subscription(
        self,
        request: Request,
        subscription_id: UUID,
        body: UpdateWebhookSubscriptionRequest,
    ):
        if is_ee():
            has_permission = await check_action_access(
                user_uid=str(request.state.user_id),
                project_id=str(request.state.project_id),
                permission=Permission.EDIT_WEBHOOKS,
            )
            if not has_permission:
                return JSONResponse(
                    {"detail": "You do not have access to perform this action"},
                    status_code=status.HTTP_403_FORBIDDEN,
                )

        # Convert API request to DTO
        dto = UpdateWebhookSubscriptionDTO(**body.model_dump())

        subscription_dto = await self.service.update_subscription(
            subscription_id=subscription_id,
            project_id=UUID(request.state.project_id),
            payload=dto,
        )
        if not subscription_dto:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Webhook subscription not found",
            )

        await invalidate_cache(
            project_id=request.state.project_id,
            namespace="webhook_query_subscriptions",
        )

        return WebhookSubscriptionResponse(**subscription_dto.model_dump())

    @intercept_exceptions()
    async def archive_subscription(self, request: Request, subscription_id: UUID):
        if is_ee():
            has_permission = await check_action_access(
                user_uid=str(request.state.user_id),
                project_id=str(request.state.project_id),
                permission=Permission.EDIT_WEBHOOKS,
            )
            if not has_permission:
                return JSONResponse(
                    {"detail": "You do not have access to perform this action"},
                    status_code=status.HTTP_403_FORBIDDEN,
                )

        subscription_dto = await self.service.archive_subscription(
            subscription_id=subscription_id,
            project_id=UUID(request.state.project_id),
        )
        if not subscription_dto:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Webhook subscription not found",
            )

        await invalidate_cache(
            project_id=request.state.project_id,
            namespace="webhook_query_subscriptions",
        )

        return WebhookSubscriptionResponse(**subscription_dto.model_dump())

    @intercept_exceptions()
    async def test_webhook(self, request: Request, body: TestWebhookRequest):
        if is_ee():
            has_permission = await check_action_access(
                user_uid=str(request.state.user_id),
                project_id=str(request.state.project_id),
                permission=Permission.EDIT_WEBHOOKS,
            )
            if not has_permission:
                return JSONResponse(
                    {"detail": "You do not have access to perform this action"},
                    status_code=status.HTTP_403_FORBIDDEN,
                )

        response = await self.service.test_webhook(
            url=str(body.url),
            event_type=body.event_type,
            project_id=UUID(request.state.project_id),
            user_id=request.state.user_id,
        )
        return response
