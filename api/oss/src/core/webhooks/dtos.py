from typing import Any, Dict, List, Optional
from uuid import UUID

from pydantic import BaseModel, HttpUrl

from oss.src.core.webhooks.events import WebhookEventType
from oss.src.core.shared.dtos import (
    Header,
    Identifier,
    Lifecycle,
    Metadata,
    Status,
)


# --- WEBHOOK SUBSCRIPTIONS -------------------------------------------------- #


class WebhookSubscriptionFlags(BaseModel):
    is_active: bool = False
    is_valid: bool = False


class WebhookSubscriptionQueryFlags(BaseModel):
    is_active: Optional[bool] = None
    is_valid: Optional[bool] = None


class WebhookSubscriptionData(BaseModel):
    url: HttpUrl
    headers: Optional[Dict[str, str]] = None

    event_types: Optional[List[WebhookEventType]] = None


class WebhookSubscription(Identifier, Lifecycle, Header, Metadata):
    flags: Optional[WebhookSubscriptionFlags] = None

    data: WebhookSubscriptionData

    secret_id: Optional[UUID] = None
    secret: Optional[str] = None


class WebhookSubscriptionCreate(Header, Metadata):
    flags: Optional[WebhookSubscriptionFlags] = None

    data: WebhookSubscriptionData


class WebhookSubscriptionEdit(Identifier, Lifecycle, Header, Metadata):
    flags: Optional[WebhookSubscriptionFlags] = None

    data: WebhookSubscriptionData


class WebhookSubscriptionQuery(Header, Metadata):
    flags: Optional[WebhookSubscriptionQueryFlags] = None


# --- WEBHOOK DELIVERIES ----------------------------------------------------- #


class WebhookDeliveryResponseInfo(BaseModel):
    status_code: Optional[int] = None
    body: Optional[str] = None


class WebhookDeliveryData(BaseModel):
    url: Optional[HttpUrl] = None

    event_type: Optional[WebhookEventType] = None

    payload: Optional[Dict[str, Any]] = None
    error: Optional[str] = None
    duration_ms: Optional[int] = None
    response: Optional[WebhookDeliveryResponseInfo] = None


class WebhookDelivery(Identifier, Lifecycle):
    status: Status

    data: Optional[WebhookDeliveryData] = None

    subscription_id: UUID
    event_id: UUID


class WebhookDeliveryCreate(Identifier):
    status: Status

    data: Optional[WebhookDeliveryData] = None

    subscription_id: UUID
    event_id: UUID


class WebhookDeliveryQuery(BaseModel):
    status: Optional[Status] = None

    subscription_id: Optional[UUID] = None
    event_id: Optional[UUID] = None
