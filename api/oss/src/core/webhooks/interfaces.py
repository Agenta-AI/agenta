"""Interfaces for webhooks data access."""

from typing import List, Optional
from uuid import UUID

from oss.src.core.shared.dtos import Windowing
from oss.src.core.webhooks.types import (
    WebhookDelivery,
    WebhookDeliveryCreate,
    WebhookDeliveryQuery,
    WebhookSubscription,
    WebhookSubscriptionCreate,
    WebhookSubscriptionEdit,
    WebhookSubscriptionQuery,
)


class WebhooksDAOInterface:
    """Interface for webhooks data access."""

    # --- subscriptions ---------------------------------------------------------

    async def create_subscription(
        self,
        *,
        project_id: UUID,
        user_id: UUID,
        #
        subscription: WebhookSubscriptionCreate,
        #
        secret_id: UUID,
    ) -> WebhookSubscription:
        raise NotImplementedError

    async def fetch_subscription(
        self,
        *,
        project_id: UUID,
        #
        subscription_id: UUID,
    ) -> Optional[WebhookSubscription]:
        raise NotImplementedError

    async def query_subscriptions(
        self,
        *,
        project_id: UUID,
        #
        subscription: Optional[WebhookSubscriptionQuery] = None,
        #
        windowing: Optional[Windowing] = None,
    ) -> List[WebhookSubscription]:
        raise NotImplementedError

    async def edit_subscription(
        self,
        *,
        project_id: UUID,
        user_id: UUID,
        #
        subscription: WebhookSubscriptionEdit,
        #
        secret_id: Optional[UUID] = None,
    ) -> Optional[WebhookSubscription]:
        raise NotImplementedError

    async def delete_subscription(
        self,
        *,
        project_id: UUID,
        #
        subscription_id: UUID,
    ) -> bool:
        raise NotImplementedError

    # --- deliveries ------------------------------------------------------------

    async def create_delivery(
        self,
        *,
        project_id: UUID,
        user_id: Optional[UUID],
        #
        delivery: WebhookDeliveryCreate,
    ) -> WebhookDelivery:
        raise NotImplementedError

    async def fetch_delivery(
        self,
        *,
        project_id: UUID,
        #
        delivery_id: UUID,
    ) -> Optional[WebhookDelivery]:
        raise NotImplementedError

    async def query_deliveries(
        self,
        *,
        project_id: UUID,
        #
        delivery: Optional[WebhookDeliveryQuery] = None,
        #
        windowing: Optional[Windowing] = None,
    ) -> List[WebhookDelivery]:
        raise NotImplementedError
