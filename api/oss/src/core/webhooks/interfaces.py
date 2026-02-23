"""Interfaces for webhooks data access."""

from typing import List, Optional
from uuid import UUID

from oss.src.core.webhooks.dtos import (
    CreateWebhookSubscriptionDTO,
    UpdateWebhookSubscriptionDTO,
    WebhookSubscriptionResponseDTO,
    WebhookSubscriptionQueryDTO,
    WebhookDeliveryResponseDTO,
)


class WebhooksDAOInterface:
    """Interface for webhooks data access."""

    def __init__(self):
        raise NotImplementedError

    # Subscription operations
    async def create_subscription(
        self,
        project_id: UUID,
        payload: CreateWebhookSubscriptionDTO,
        user_id: UUID,
        secret_id: Optional[UUID] = None,
    ) -> WebhookSubscriptionResponseDTO:
        raise NotImplementedError

    async def get_subscription(
        self, project_id: UUID, subscription_id: UUID
    ) -> Optional[WebhookSubscriptionResponseDTO]:
        raise NotImplementedError

    async def fetch_subscription_by_id(
        self, subscription_id: UUID
    ) -> Optional[WebhookSubscriptionResponseDTO]:
        raise NotImplementedError

    async def query_subscriptions(
        self,
        project_id: UUID,
        filters: Optional[WebhookSubscriptionQueryDTO] = None,
        offset: int = 0,
        limit: int = 20,
    ) -> tuple[List[WebhookSubscriptionResponseDTO], int]:
        raise NotImplementedError

    async def update_subscription(
        self,
        project_id: UUID,
        subscription_id: UUID,
        payload: UpdateWebhookSubscriptionDTO,
    ) -> Optional[WebhookSubscriptionResponseDTO]:
        raise NotImplementedError

    async def archive_subscription(
        self, project_id: UUID, subscription_id: UUID
    ) -> Optional[WebhookSubscriptionResponseDTO]:
        raise NotImplementedError

    # Event operations
    async def get_active_subscriptions_for_event(
        self, project_id: UUID, event_type: str
    ) -> List[WebhookSubscriptionResponseDTO]:
        raise NotImplementedError

    # Delivery operations
    async def create_delivery(
        self,
        subscription_id: UUID,
        event_id: UUID,
        status: str,
        created_by_id: Optional[UUID],
        data: Optional[dict] = None,
    ) -> WebhookDeliveryResponseDTO:
        raise NotImplementedError

    async def update_delivery_status(
        self,
        delivery_id: UUID,
        status: str,
        data: Optional[dict] = None,
        updated_by_id: Optional[UUID] = None,
    ) -> WebhookDeliveryResponseDTO:
        raise NotImplementedError

    async def get_delivery(
        self, delivery_id: UUID
    ) -> Optional[WebhookDeliveryResponseDTO]:
        raise NotImplementedError

    async def record_test_delivery(
        self,
        subscription_id: UUID,
        event_id: UUID,
        status: str,
        created_by_id: Optional[UUID],
        data: Optional[dict] = None,
    ) -> WebhookDeliveryResponseDTO:
        raise NotImplementedError
