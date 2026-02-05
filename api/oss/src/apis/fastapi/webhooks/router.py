from uuid import UUID
from typing import List

from fastapi import APIRouter, Request, status, HTTPException
from fastapi.responses import JSONResponse

from oss.src.utils.common import is_ee
from oss.src.utils.logging import get_module_logger
from oss.src.utils.exceptions import intercept_exceptions
from oss.src.core.webhooks.service import WebhooksService
from oss.src.apis.fastapi.webhooks.schemas import (
    CreateWebhookSubscription,
    UpdateWebhookSubscription,
    WebhookSubscription,
    TestWebhookPayload,
    TestWebhookResponse,
)

if is_ee():
    from ee.src.models.shared_models import Permission
    from ee.src.utils.permissions import check_action_access

log = get_module_logger(__name__)


class WebhooksRouter:
    def __init__(self, webhooks_service: WebhooksService):
        self.service = webhooks_service
        self.router = APIRouter()

        self.router.add_api_route(
            "/",
            self.create_subscription,
            methods=["POST"],
            operation_id="create_webhook_subscription",
            response_model=WebhookSubscription,
        )
        self.router.add_api_route(
            "/",
            self.list_subscriptions,
            methods=["GET"],
            operation_id="list_webhook_subscriptions",
            response_model=List[WebhookSubscription],
        )
        self.router.add_api_route(
            "/{subscription_id}",
            self.get_subscription,
            methods=["GET"],
            operation_id="get_webhook_subscription",
            response_model=WebhookSubscription,
        )
        self.router.add_api_route(
            "/{subscription_id}",
            self.update_subscription,
            methods=["PUT"],
            operation_id="update_webhook_subscription",
            response_model=WebhookSubscription,
        )
        self.router.add_api_route(
            "/{subscription_id}",
            self.delete_subscription,
            methods=["DELETE"],
            operation_id="delete_webhook_subscription",
            status_code=status.HTTP_204_NO_CONTENT,
        )
        self.router.add_api_route(
            "/test",
            self.test_webhook,
            methods=["POST"],
            operation_id="test_webhook",
            response_model=TestWebhookResponse,
        )

    @intercept_exceptions()
    async def create_subscription(
        self, request: Request, body: CreateWebhookSubscription
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

        subscription = await self.service.create_subscription(
            user_id=request.state.user_id,
            workspace_id=UUID(request.state.workspace_id),
            payload=body,
        )
        return subscription

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

        subscriptions = await self.service.list_subscriptions(
            workspace_id=UUID(request.state.workspace_id),
        )
        return subscriptions

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

        subscription = await self.service.get_subscription(
            subscription_id=subscription_id,
            workspace_id=UUID(request.state.workspace_id),
        )
        if not subscription:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Webhook subscription not found",
            )
        return subscription

    @intercept_exceptions()
    async def update_subscription(
        self, request: Request, subscription_id: UUID, body: UpdateWebhookSubscription
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

        subscription = await self.service.update_subscription(
            subscription_id=subscription_id,
            workspace_id=UUID(request.state.workspace_id),
            payload=body,
        )
        if not subscription:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Webhook subscription not found",
            )
        return subscription

    @intercept_exceptions()
    async def delete_subscription(self, request: Request, subscription_id: UUID):
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

        await self.service.delete_subscription(
            subscription_id=subscription_id,
            workspace_id=UUID(request.state.workspace_id),
        )

    @intercept_exceptions()
    async def test_webhook(self, request: Request, body: TestWebhookPayload):
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
            workspace_id=UUID(request.state.workspace_id),
            user_id=request.state.user_id,
        )
        return response
