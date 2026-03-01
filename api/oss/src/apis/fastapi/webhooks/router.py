"""FastAPI router for webhooks endpoints."""

from uuid import UUID

from fastapi import APIRouter, Request, status, HTTPException

from oss.src.utils.common import is_ee
from oss.src.utils.exceptions import intercept_exceptions
from oss.src.utils.caching import get_cache, set_cache, invalidate_cache
from oss.src.core.webhooks.service import WebhooksService
from oss.src.core.webhooks.exceptions import (
    WebhookSubscriptionNotFoundError,
    WebhookTestDeliveryTimeoutError,
    WebhookTestEventPublishFailedError,
)
from oss.src.apis.fastapi.webhooks.models import (
    WebhookDeliveryCreateRequest,
    WebhookDeliveryQueryRequest,
    WebhookDeliveriesResponse,
    WebhookDeliveryResponse,
    WebhookSubscriptionCreateRequest,
    WebhookSubscriptionEditRequest,
    WebhookSubscriptionQueryRequest,
    WebhookSubscriptionResponse,
    WebhookSubscriptionsResponse,
)

if is_ee():
    from ee.src.models.shared_models import Permission
    from ee.src.utils.permissions import check_action_access, FORBIDDEN_EXCEPTION


class WebhooksRouter:
    def __init__(self, *, webhooks_service: WebhooksService):
        self.webhooks_service = webhooks_service
        self.router = APIRouter()

        self.router.add_api_route(
            "/",
            self.create_subscription,
            methods=["POST"],
            operation_id="create_webhook_subscription",
            response_model=WebhookSubscriptionResponse,
            response_model_exclude_none=True,
            status_code=status.HTTP_200_OK,
        )

        # /query and /test MUST be registered before /{subscription_id}
        self.router.add_api_route(
            "/query",
            self.query_subscriptions,
            methods=["POST"],
            operation_id="query_webhook_subscriptions",
            response_model=WebhookSubscriptionsResponse,
            response_model_exclude_none=True,
            status_code=status.HTTP_200_OK,
        )
        self.router.add_api_route(
            "/test/{subscription_id}",
            self.test_webhook,
            methods=["POST"],
            operation_id="test_webhook",
            response_model=WebhookDeliveryResponse,
            response_model_exclude_none=True,
            status_code=status.HTTP_200_OK,
        )
        self.router.add_api_route(
            "/deliveries",
            self.create_delivery,
            methods=["POST"],
            operation_id="create_webhook_delivery",
            response_model=WebhookDeliveryResponse,
            response_model_exclude_none=True,
            status_code=status.HTTP_200_OK,
        )
        self.router.add_api_route(
            "/deliveries/query",
            self.query_deliveries,
            methods=["POST"],
            operation_id="query_webhook_deliveries",
            response_model=WebhookDeliveriesResponse,
            response_model_exclude_none=True,
            status_code=status.HTTP_200_OK,
        )
        self.router.add_api_route(
            "/deliveries/{delivery_id}",
            self.fetch_delivery,
            methods=["GET"],
            operation_id="fetch_webhook_delivery",
            response_model=WebhookDeliveryResponse,
            response_model_exclude_none=True,
            status_code=status.HTTP_200_OK,
        )
        self.router.add_api_route(
            "/{subscription_id}",
            self.fetch_subscription,
            methods=["GET"],
            operation_id="fetch_webhook_subscription",
            response_model=WebhookSubscriptionResponse,
            response_model_exclude_none=True,
            status_code=status.HTTP_200_OK,
        )
        self.router.add_api_route(
            "/{subscription_id}",
            self.edit_subscription,
            methods=["PUT"],
            operation_id="edit_webhook_subscription",
            response_model=WebhookSubscriptionResponse,
            response_model_exclude_none=True,
            status_code=status.HTTP_200_OK,
        )
        self.router.add_api_route(
            "/{subscription_id}/archive",
            self.archive_subscription,
            methods=["POST"],
            operation_id="archive_webhook_subscription",
            response_model=WebhookSubscriptionResponse,
            response_model_exclude_none=True,
            status_code=status.HTTP_200_OK,
        )
        self.router.add_api_route(
            "/{subscription_id}/unarchive",
            self.unarchive_subscription,
            methods=["POST"],
            operation_id="unarchive_webhook_subscription",
            response_model=WebhookSubscriptionResponse,
            response_model_exclude_none=True,
            status_code=status.HTTP_200_OK,
        )

    @intercept_exceptions()
    async def create_subscription(
        self,
        request: Request,
        *,
        body: WebhookSubscriptionCreateRequest,
    ) -> WebhookSubscriptionResponse:
        if is_ee():
            has_permission = await check_action_access(
                user_uid=str(request.state.user_id),
                project_id=str(request.state.project_id),
                permission=Permission.EDIT_WEBHOOKS,
            )
            if not has_permission:
                raise FORBIDDEN_EXCEPTION  # type: ignore

        subscription = await self.webhooks_service.create_subscription(
            user_id=UUID(str(request.state.user_id)),
            project_id=UUID(request.state.project_id),
            subscription=body.subscription,
        )

        await invalidate_cache(
            project_id=request.state.project_id,
            namespace="webhook_query_subscriptions",
        )

        return WebhookSubscriptionResponse(
            count=1 if subscription else 0,
            subscription=subscription,
        )

    @intercept_exceptions()
    async def query_subscriptions(
        self,
        request: Request,
        *,
        body: WebhookSubscriptionQueryRequest,
    ) -> WebhookSubscriptionsResponse:
        if is_ee():
            has_permission = await check_action_access(
                user_uid=str(request.state.user_id),
                project_id=str(request.state.project_id),
                permission=Permission.VIEW_WEBHOOKS,
            )
            if not has_permission:
                raise FORBIDDEN_EXCEPTION  # type: ignore

        cache_key = {
            k: v
            for k, v in {
                "include_archived": bool(body.include_archived),
                "name": (
                    body.subscription.name
                    if body.subscription and body.subscription.name is not None
                    else None
                ),
                "description": (
                    body.subscription.description
                    if body.subscription and body.subscription.description is not None
                    else None
                ),
                "flags": (
                    body.subscription.flags.model_dump(mode="json", exclude_none=True)
                    if body.subscription and body.subscription.flags
                    else None
                ),
                "tags": (
                    body.subscription.tags
                    if body.subscription and body.subscription.tags is not None
                    else None
                ),
                "oldest": (
                    body.windowing.oldest.isoformat()
                    if body.windowing and body.windowing.oldest
                    else None
                ),
                "newest": (
                    body.windowing.newest.isoformat()
                    if body.windowing and body.windowing.newest
                    else None
                ),
                "order": (
                    body.windowing.order
                    if body.windowing and body.windowing.order
                    else None
                ),
                "limit": (
                    body.windowing.limit
                    if body.windowing and body.windowing.limit is not None
                    else None
                ),
                "next": (
                    str(body.windowing.next)
                    if body.windowing and body.windowing.next
                    else None
                ),
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

        subscriptions = await self.webhooks_service.query_subscriptions(
            project_id=UUID(request.state.project_id),
            #
            subscription=body.subscription,
            #
            include_archived=body.include_archived,
            #
            windowing=body.windowing,
        )

        response = WebhookSubscriptionsResponse(
            count=len(subscriptions),
            subscriptions=subscriptions,
        )

        await set_cache(
            project_id=request.state.project_id,
            namespace="webhook_query_subscriptions",
            key=cache_key,
            value=response,
        )

        return response

    @intercept_exceptions()
    async def fetch_subscription(
        self,
        request: Request,
        *,
        subscription_id: UUID,
    ) -> WebhookSubscriptionResponse:
        if is_ee():
            has_permission = await check_action_access(
                user_uid=str(request.state.user_id),
                project_id=str(request.state.project_id),
                permission=Permission.VIEW_WEBHOOKS,
            )
            if not has_permission:
                raise FORBIDDEN_EXCEPTION  # type: ignore

        subscription = await self.webhooks_service.fetch_subscription(
            subscription_id=subscription_id,
            project_id=UUID(request.state.project_id),
        )
        if not subscription:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Webhook subscription not found",
            )

        return WebhookSubscriptionResponse(
            count=1,
            subscription=subscription,
        )

    @intercept_exceptions()
    async def edit_subscription(
        self,
        request: Request,
        *,
        subscription_id: UUID,
        body: WebhookSubscriptionEditRequest,
    ) -> WebhookSubscriptionResponse:
        if is_ee():
            has_permission = await check_action_access(
                user_uid=str(request.state.user_id),
                project_id=str(request.state.project_id),
                permission=Permission.EDIT_WEBHOOKS,
            )
            if not has_permission:
                raise FORBIDDEN_EXCEPTION  # type: ignore

        if str(subscription_id) != str(body.subscription.id):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Path subscription_id does not match body id",
            )

        subscription = await self.webhooks_service.edit_subscription(
            project_id=UUID(request.state.project_id),
            user_id=UUID(str(request.state.user_id)),
            subscription=body.subscription,
        )
        if not subscription:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Webhook subscription not found",
            )

        await invalidate_cache(
            project_id=request.state.project_id,
            namespace="webhook_query_subscriptions",
        )

        return WebhookSubscriptionResponse(
            count=1,
            subscription=subscription,
        )

    @intercept_exceptions()
    async def archive_subscription(
        self,
        request: Request,
        *,
        subscription_id: UUID,
    ) -> WebhookSubscriptionResponse:
        if is_ee():
            has_permission = await check_action_access(
                user_uid=str(request.state.user_id),
                project_id=str(request.state.project_id),
                permission=Permission.EDIT_WEBHOOKS,
            )
            if not has_permission:
                raise FORBIDDEN_EXCEPTION  # type: ignore

        subscription = await self.webhooks_service.archive_subscription(
            subscription_id=subscription_id,
            project_id=UUID(request.state.project_id),
            user_id=UUID(str(request.state.user_id)),
        )
        if not subscription:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Webhook subscription not found",
            )

        await invalidate_cache(
            project_id=request.state.project_id,
            namespace="webhook_query_subscriptions",
        )

        return WebhookSubscriptionResponse(
            count=1,
            subscription=subscription,
        )

    @intercept_exceptions()
    async def unarchive_subscription(
        self,
        request: Request,
        *,
        subscription_id: UUID,
    ) -> WebhookSubscriptionResponse:
        if is_ee():
            has_permission = await check_action_access(
                user_uid=str(request.state.user_id),
                project_id=str(request.state.project_id),
                permission=Permission.EDIT_WEBHOOKS,
            )
            if not has_permission:
                raise FORBIDDEN_EXCEPTION  # type: ignore

        subscription = await self.webhooks_service.unarchive_subscription(
            subscription_id=subscription_id,
            project_id=UUID(request.state.project_id),
            user_id=UUID(str(request.state.user_id)),
        )
        if not subscription:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Webhook subscription not found",
            )

        await invalidate_cache(
            project_id=request.state.project_id,
            namespace="webhook_query_subscriptions",
        )

        return WebhookSubscriptionResponse(
            count=1,
            subscription=subscription,
        )

    @intercept_exceptions()
    async def create_delivery(
        self,
        request: Request,
        *,
        body: WebhookDeliveryCreateRequest,
    ) -> WebhookDeliveryResponse:
        if is_ee():
            has_permission = await check_action_access(
                user_uid=str(request.state.user_id),
                project_id=str(request.state.project_id),
                permission=Permission.EDIT_WEBHOOKS,
            )
            if not has_permission:
                raise FORBIDDEN_EXCEPTION  # type: ignore

        delivery = await self.webhooks_service.create_delivery(
            project_id=UUID(request.state.project_id),
            user_id=UUID(str(request.state.user_id)),
            delivery=body.delivery,
        )

        return WebhookDeliveryResponse(
            count=1 if delivery else 0,
            delivery=delivery,
        )

    @intercept_exceptions()
    async def fetch_delivery(
        self,
        request: Request,
        *,
        delivery_id: UUID,
    ) -> WebhookDeliveryResponse:
        if is_ee():
            has_permission = await check_action_access(
                user_uid=str(request.state.user_id),
                project_id=str(request.state.project_id),
                permission=Permission.VIEW_WEBHOOKS,
            )
            if not has_permission:
                raise FORBIDDEN_EXCEPTION  # type: ignore

        delivery = await self.webhooks_service.fetch_delivery(
            project_id=UUID(request.state.project_id),
            delivery_id=delivery_id,
        )
        if not delivery:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Webhook delivery not found",
            )

        return WebhookDeliveryResponse(
            count=1,
            delivery=delivery,
        )

    @intercept_exceptions()
    async def query_deliveries(
        self,
        request: Request,
        *,
        body: WebhookDeliveryQueryRequest,
    ) -> WebhookDeliveriesResponse:
        if is_ee():
            has_permission = await check_action_access(
                user_uid=str(request.state.user_id),
                project_id=str(request.state.project_id),
                permission=Permission.VIEW_WEBHOOKS,
            )
            if not has_permission:
                raise FORBIDDEN_EXCEPTION  # type: ignore

        deliveries = await self.webhooks_service.query_deliveries(
            project_id=UUID(request.state.project_id),
            #
            delivery=body.delivery,
            #
            include_archived=body.include_archived,
            #
            windowing=body.windowing,
        )

        return WebhookDeliveriesResponse(
            count=len(deliveries),
            deliveries=deliveries,
        )

    @intercept_exceptions()
    async def test_webhook(
        self,
        request: Request,
        *,
        subscription_id: UUID,
    ) -> WebhookDeliveryResponse:
        if is_ee():
            has_permission = await check_action_access(
                user_uid=str(request.state.user_id),
                project_id=str(request.state.project_id),
                permission=Permission.EDIT_WEBHOOKS,
            )
            if not has_permission:
                raise FORBIDDEN_EXCEPTION  # type: ignore

        try:
            delivery = await self.webhooks_service.test_webhook(
                project_id=UUID(request.state.project_id),
                user_id=UUID(str(request.state.user_id)),
                subscription_id=subscription_id,
            )
            return WebhookDeliveryResponse(
                count=1 if delivery else 0,
                delivery=delivery,
            )
        except WebhookSubscriptionNotFoundError as e:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=str(e),
            ) from e
        except WebhookTestEventPublishFailedError as e:
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail={
                    "code": "WEBHOOK_TEST_EVENT_PUBLISH_FAILED",
                    "message": e.message,
                    "event_id": e.event_id,
                    "subscription_id": e.subscription_id,
                },
            ) from e
        except WebhookTestDeliveryTimeoutError as e:
            raise HTTPException(
                status_code=status.HTTP_504_GATEWAY_TIMEOUT,
                detail={
                    "code": "WEBHOOK_TEST_DELIVERY_TIMEOUT",
                    "message": e.message,
                    "event_id": e.event_id,
                    "subscription_id": e.subscription_id,
                    "attempts": e.attempts,
                },
            ) from e
