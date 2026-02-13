"""Interfaces for webhooks data access."""

from datetime import datetime
from typing import List, Optional
from uuid import UUID

from oss.src.core.webhooks.dtos import (
    CreateWebhookSubscriptionDTO,
    UpdateWebhookSubscriptionDTO,
    WebhookSubscriptionResponseDTO,
    WebhookEventResponseDTO,
    WebhookDeliveryResponseDTO,
)


class WebhooksDAOInterface:
    """Interface for webhooks data access."""

    def __init__(self):
        raise NotImplementedError

    # Subscription operations
    async def create_subscription(
        self,
        workspace_id: UUID,
        payload: CreateWebhookSubscriptionDTO,
        user_id: Optional[UUID] = None,
        secret: str = "",
    ) -> WebhookSubscriptionResponseDTO:
        raise NotImplementedError

    async def get_subscription(
        self, workspace_id: UUID, subscription_id: UUID
    ) -> Optional[WebhookSubscriptionResponseDTO]:
        raise NotImplementedError

    async def fetch_subscription_by_id(
        self, subscription_id: UUID
    ) -> Optional[WebhookSubscriptionResponseDTO]:
        raise NotImplementedError

    async def list_subscriptions(
        self, workspace_id: UUID
    ) -> List[WebhookSubscriptionResponseDTO]:
        raise NotImplementedError

    async def update_subscription(
        self,
        workspace_id: UUID,
        subscription_id: UUID,
        payload: UpdateWebhookSubscriptionDTO,
    ) -> Optional[WebhookSubscriptionResponseDTO]:
        raise NotImplementedError

    async def delete_subscription(
        self, workspace_id: UUID, subscription_id: UUID
    ) -> bool:
        raise NotImplementedError

    # Event operations
    async def create_event(
        self,
        workspace_id: UUID,
        event_type: str,
        payload: dict,
    ) -> WebhookEventResponseDTO:
        raise NotImplementedError

    async def get_active_subscriptions_for_event(
        self, workspace_id: UUID, event_type: str
    ) -> List[WebhookSubscriptionResponseDTO]:
        raise NotImplementedError

    # Delivery operations
    async def create_delivery(
        self,
        subscription_id: UUID,
        event_type: str,
        payload: dict,
        event_id: Optional[UUID] = None,
    ) -> WebhookDeliveryResponseDTO:
        raise NotImplementedError

    async def get_delivery(
        self, delivery_id: UUID
    ) -> Optional[WebhookDeliveryResponseDTO]:
        raise NotImplementedError

    async def update_delivery_status(
        self,
        delivery_id: UUID,
        status: str,
        response_status_code: Optional[int] = None,
        response_body: Optional[str] = None,
        duration_ms: Optional[int] = None,
        error_message: Optional[str] = None,
        next_retry_at: Optional[datetime] = None,
    ) -> Optional[WebhookDeliveryResponseDTO]:
        raise NotImplementedError
