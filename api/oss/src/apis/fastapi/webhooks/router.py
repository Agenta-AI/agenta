from uuid import UUID

from fastapi import APIRouter, Request, status, HTTPException

from oss.src.utils.common import is_ee
from oss.src.utils.exceptions import intercept_exceptions
from oss.src.utils.logging import get_module_logger
from oss.src.utils.caching import (
    AGENTA_CACHE_TTL,
    get_cache,
    invalidate_cache,
    set_cache,
)
from oss.src.utils.crypting import decrypt, encrypt
from oss.src.core.webhooks.service import WebhooksService
from oss.src.core.webhooks.types import WebhookSubscription
from oss.src.core.webhooks.exceptions import (
    WebhookAuthorizationSecretRequiredError,
    WebhookSubscriptionNotFoundError,
    WebhookTestDeliveryTimeoutError,
    WebhookTestEventPublishFailedError,
)
from oss.src.apis.fastapi.webhooks.models import (
    WebhookSubscriptionCreateRequest,
    WebhookSubscriptionDraftTestRequest,
    WebhookSubscriptionEditRequest,
    WebhookSubscriptionQueryRequest,
    WebhookSubscriptionResponse,
    WebhookSubscriptionsResponse,
    #
    WebhookDeliveryCreateRequest,
    WebhookDeliveryQueryRequest,
    WebhookDeliveryResponse,
    WebhookDeliveriesResponse,
)

if is_ee():
    from ee.src.models.shared_models import Permission
    from ee.src.utils.permissions import check_action_access, FORBIDDEN_EXCEPTION


log = get_module_logger(__name__)


class WebhooksRouter:
    def __init__(
        self,
        *,
        webhooks_service: WebhooksService,
    ):
        self.webhooks_service = webhooks_service

        self.router = APIRouter()

        # --- WEBHOOK SUBSCRIPTIONS ------------------------------------------ #

        self.router.add_api_route(
            "/subscriptions/",
            self.create_subscription,
            methods=["POST"],
            operation_id="create_webhook_subscription",
            response_model=WebhookSubscriptionResponse,
            response_model_exclude_none=True,
            status_code=status.HTTP_200_OK,
        )
        self.router.add_api_route(
            "/subscriptions/test-draft",
            self.test_draft_webhook,
            methods=["POST"],
            operation_id="test_webhook_draft",
            response_model=WebhookDeliveryResponse,
            response_model_exclude_none=True,
            status_code=status.HTTP_200_OK,
        )
        self.router.add_api_route(
            "/subscriptions/{subscription_id}",
            self.fetch_subscription,
            methods=["GET"],
            operation_id="fetch_webhook_subscription",
            response_model=WebhookSubscriptionResponse,
            response_model_exclude_none=True,
            status_code=status.HTTP_200_OK,
        )
        self.router.add_api_route(
            "/subscriptions/{subscription_id}",
            self.edit_subscription,
            methods=["PUT"],
            operation_id="edit_webhook_subscription",
            response_model=WebhookSubscriptionResponse,
            response_model_exclude_none=True,
            status_code=status.HTTP_200_OK,
        )
        self.router.add_api_route(
            "/subscriptions/{subscription_id}",
            self.delete_subscription,
            methods=["DELETE"],
            operation_id="delete_webhook_subscription",
            status_code=status.HTTP_204_NO_CONTENT,
        )
        self.router.add_api_route(
            "/subscriptions/query",
            self.query_subscriptions,
            methods=["POST"],
            operation_id="query_webhook_subscriptions",
            response_model=WebhookSubscriptionsResponse,
            response_model_exclude_none=True,
            status_code=status.HTTP_200_OK,
        )

        self.router.add_api_route(
            "/subscriptions/{subscription_id}/test",
            self.test_webhook,
            methods=["POST"],
            operation_id="test_webhook",
            response_model=WebhookDeliveryResponse,
            response_model_exclude_none=True,
            status_code=status.HTTP_200_OK,
        )

        # --- WEBHOOK DELIVERIES --------------------------------------------- #

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
            "/deliveries/{delivery_id}",
            self.fetch_delivery,
            methods=["GET"],
            operation_id="fetch_webhook_delivery",
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

    # --- WEBHOOK SUBSCRIPTIONS ---------------------------------------------- #

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

        try:
            subscription = await self.webhooks_service.create_subscription(
                project_id=UUID(request.state.project_id),
                user_id=UUID(str(request.state.user_id)),
                #
                subscription=body.subscription,
            )
        except WebhookAuthorizationSecretRequiredError as e:
            raise HTTPException(status_code=400, detail=e.message) from e

        await set_cache(
            namespace="webhooks",
            project_id=str(request.state.project_id),
            key=f"subscription:{subscription.id}",
            value=subscription.model_copy(
                update={"secret": encrypt(subscription.secret)}
            )
            if subscription.secret
            else subscription,
            ttl=AGENTA_CACHE_TTL,
        )
        await invalidate_cache(
            namespace="webhooks",
            project_id=str(request.state.project_id),
            key="subscriptions",
        )

        return WebhookSubscriptionResponse(
            count=1 if subscription else 0,
            subscription=subscription,
        )

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

        cached = await get_cache(
            namespace="webhooks",
            project_id=str(request.state.project_id),
            key=f"subscription:{subscription_id}",
            model=WebhookSubscription,
            is_list=False,
        )

        if cached is not None:
            if cached.secret:
                try:
                    cached = cached.model_copy(
                        update={"secret": decrypt(cached.secret)}
                    )
                except Exception:
                    cached = cached.model_copy(update={"secret": None})
            return WebhookSubscriptionResponse(count=1, subscription=cached)

        subscription = await self.webhooks_service.fetch_subscription(
            project_id=UUID(request.state.project_id),
            #
            subscription_id=subscription_id,
        )

        if not subscription:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Webhook subscription not found",
            )

        await set_cache(
            namespace="webhooks",
            project_id=str(request.state.project_id),
            key=f"subscription:{subscription_id}",
            value=subscription.model_copy(
                update={"secret": encrypt(subscription.secret)}
            )
            if subscription.secret
            else subscription,
            ttl=AGENTA_CACHE_TTL,
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
            #
            subscription=body.subscription,
        )

        if not subscription:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Webhook subscription not found",
            )

        await set_cache(
            namespace="webhooks",
            project_id=str(request.state.project_id),
            key=f"subscription:{subscription.id}",
            value=subscription.model_copy(
                update={"secret": encrypt(subscription.secret)}
            )
            if subscription.secret
            else subscription,
            ttl=AGENTA_CACHE_TTL,
        )
        await invalidate_cache(
            namespace="webhooks",
            project_id=str(request.state.project_id),
            key="subscriptions",
        )

        return WebhookSubscriptionResponse(
            count=1,
            subscription=subscription,
        )

    @intercept_exceptions()
    async def delete_subscription(
        self,
        request: Request,
        *,
        subscription_id: UUID,
    ) -> None:
        if is_ee():
            has_permission = await check_action_access(
                user_uid=str(request.state.user_id),
                project_id=str(request.state.project_id),
                permission=Permission.EDIT_WEBHOOKS,
            )
            if not has_permission:
                raise FORBIDDEN_EXCEPTION  # type: ignore

        deleted = await self.webhooks_service.delete_subscription(
            project_id=UUID(request.state.project_id),
            #
            subscription_id=subscription_id,
        )

        if not deleted:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Webhook subscription not found",
            )

        await invalidate_cache(
            namespace="webhooks",
            project_id=str(request.state.project_id),
            key=f"subscription:{subscription_id}",
        )
        await invalidate_cache(
            namespace="webhooks",
            project_id=str(request.state.project_id),
            key="subscriptions",
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

        subscriptions = await self.webhooks_service.query_subscriptions(
            project_id=UUID(request.state.project_id),
            #
            subscription=body.subscription,
            #
            windowing=body.windowing,
        )

        return WebhookSubscriptionsResponse(
            count=len(subscriptions),
            subscriptions=subscriptions,
        )

    # --- WEBHOOK DELIVERIES ------------------------------------------------- #

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
            #
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
            #
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
            windowing=body.windowing,
        )

        return WebhookDeliveriesResponse(
            count=len(deliveries),
            deliveries=deliveries,
        )

    # --- WEBHOOK TESTS ------------------------------------------------------ #

    @intercept_exceptions()
    async def test_draft_webhook(
        self,
        request: Request,
        *,
        body: WebhookSubscriptionDraftTestRequest,
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
            delivery = await self.webhooks_service.test_draft_webhook(
                project_id=UUID(request.state.project_id),
                subscription=body.subscription,
            )
        except WebhookAuthorizationSecretRequiredError as e:
            raise HTTPException(status_code=400, detail=e.message) from e
        except WebhookSubscriptionNotFoundError as e:
            raise HTTPException(status_code=404, detail=str(e)) from e

        return WebhookDeliveryResponse(
            count=1 if delivery else 0,
            delivery=delivery,
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

        project_id = UUID(request.state.project_id)
        user_id = str(request.state.user_id)

        log.info(
            "[WEBHOOKS API] Test webhook requested",
            project_id=str(project_id),
            subscription_id=str(subscription_id),
            user_id=user_id,
        )

        try:
            delivery = await self.webhooks_service.test_webhook(
                project_id=project_id,
                #
                subscription_id=subscription_id,
            )

            status_message = delivery.status.message if delivery.status else None
            status_code = delivery.status.code if delivery.status else None

            log.info(
                "[WEBHOOKS API] Test webhook completed",
                project_id=str(project_id),
                subscription_id=str(subscription_id),
                delivery_id=str(delivery.id),
                event_id=str(delivery.event_id),
                status_message=status_message,
                status_code=status_code,
            )

            if delivery.status and delivery.status.message == "success":
                log.info(
                    "[WEBHOOKS API] Invalidating webhook caches after successful test",
                    project_id=str(project_id),
                    subscription_id=str(subscription_id),
                    delivery_id=str(delivery.id),
                )
                await invalidate_cache(
                    namespace="webhooks",
                    project_id=str(project_id),
                    key=f"subscription:{subscription_id}",
                )
                await invalidate_cache(
                    namespace="webhooks",
                    project_id=str(project_id),
                    key="subscriptions",
                )

            return WebhookDeliveryResponse(
                count=1 if delivery else 0,
                delivery=delivery,
            )
        except WebhookSubscriptionNotFoundError as e:
            log.warning(
                "[WEBHOOKS API] Test webhook failed: subscription not found",
                project_id=str(project_id),
                subscription_id=str(subscription_id),
            )
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=str(e),
            ) from e
        except WebhookTestEventPublishFailedError as e:
            log.error(
                "[WEBHOOKS API] Test webhook failed while publishing event",
                project_id=str(project_id),
                subscription_id=e.subscription_id,
                event_id=e.event_id,
                message=e.message,
            )
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
            log.error(
                "[WEBHOOKS API] Test webhook timed out waiting for delivery",
                project_id=str(project_id),
                subscription_id=e.subscription_id,
                event_id=e.event_id,
                attempts=e.attempts,
                message=e.message,
            )
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
