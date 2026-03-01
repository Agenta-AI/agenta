from typing import List, Optional

from pydantic import BaseModel

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

# --- WEBHOOK SUBSCRIPTIONS -------------------------------------------------- #


class WebhookSubscriptionCreateRequest(BaseModel):
    subscription: WebhookSubscriptionCreate


class WebhookSubscriptionEditRequest(BaseModel):
    subscription: WebhookSubscriptionEdit


class WebhookSubscriptionQueryRequest(BaseModel):
    subscription: Optional[WebhookSubscriptionQuery] = None

    include_archived: Optional[bool] = None

    windowing: Optional[Windowing] = None


class WebhookSubscriptionResponse(BaseModel):
    count: int = 0
    subscription: Optional[WebhookSubscription] = None


class WebhookSubscriptionsResponse(BaseModel):
    count: int
    subscriptions: List[WebhookSubscription] = []


# --- WEBHOOK DELIVERIES ----------------------------------------------------- #


class WebhookDeliveryCreateRequest(BaseModel):
    delivery: WebhookDeliveryCreate


class WebhookDeliveryQueryRequest(BaseModel):
    delivery: Optional[WebhookDeliveryQuery] = None

    include_archived: Optional[bool] = None

    windowing: Optional[Windowing] = None


class WebhookDeliveryResponse(BaseModel):
    count: int = 0
    delivery: Optional[WebhookDelivery] = None


class WebhookDeliveriesResponse(BaseModel):
    count: int
    deliveries: List[WebhookDelivery] = []
