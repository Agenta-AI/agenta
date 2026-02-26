"""API request and response models for webhooks endpoints."""

from typing import List, Optional
from uuid import UUID

from pydantic import BaseModel, HttpUrl

from oss.src.core.shared.dtos import Windowing
from oss.src.core.webhooks.dtos import (
    WebhookDelivery,
    WebhookDeliveryCreate,
    WebhookDeliveryQuery,
    WebhookSubscription,
    WebhookSubscriptionCreate,
    WebhookSubscriptionEdit,
    WebhookSubscriptionQuery,
)

# Request models — DTOs are the wire format; no duplication needed
WebhookSubscriptionCreateRequest = WebhookSubscriptionCreate
WebhookSubscriptionEditRequest = WebhookSubscriptionEdit
WebhookDeliveryCreateRequest = WebhookDeliveryCreate

# Response models — same shape as the DTO
WebhookSubscriptionResponse = WebhookSubscription
WebhookDeliveryResponse = WebhookDelivery


# Query request models — combine DTO filter with windowing/lifecycle controls
class WebhookSubscriptionQueryRequest(BaseModel):
    subscription: Optional[WebhookSubscriptionQuery] = None
    include_archived: Optional[bool] = None
    windowing: Optional[Windowing] = None


class WebhookDeliveryQueryRequest(BaseModel):
    delivery: Optional[WebhookDeliveryQuery] = None
    include_archived: Optional[bool] = None
    windowing: Optional[Windowing] = None


# Query response envelopes
class WebhookSubscriptionsResponse(BaseModel):
    count: int
    subscriptions: List[WebhookSubscription]


class WebhookDeliveriesResponse(BaseModel):
    count: int
    deliveries: List[WebhookDelivery]


# Test endpoint models (pure API concerns, no DTO equivalent)
class TestWebhookRequest(BaseModel):
    url: HttpUrl
    event_type: str = "config.deployed"
    subscription_id: Optional[UUID] = None


class TestWebhookResponse(BaseModel):
    success: bool
    status_code: Optional[int]
    response_body: Optional[str]
    duration_ms: int
    test_secret: str
    signature_format: str
    signing_payload: Optional[str] = None
