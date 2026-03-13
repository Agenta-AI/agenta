from enum import Enum
from typing import Any, Dict, List, Literal, Optional
from uuid import UUID

from pydantic import BaseModel, HttpUrl

from oss.src.core.events.types import EventType
from oss.src.core.shared.dtos import (
    Header,
    Identifier,
    Lifecycle,
    Metadata,
    Status,
)


# --- CONFIGURATION --------------------------------------------------------- #

WEBHOOK_MAX_RETRIES = 5

WEBHOOK_TIMEOUT = 10.0  # seconds per request

WEBHOOK_TEST_POLL_INTERVAL_MS = 500
WEBHOOK_TEST_MAX_ATTEMPTS = 20


# --- CONTEXT ALLOWLISTS ----------------------------------------------------- #

EVENT_CONTEXT_FIELDS = {
    "event_id",
    "event_type",
    "timestamp",
    "created_at",
    "attributes",
}

SUBSCRIPTION_CONTEXT_FIELDS = {
    "id",
    "name",
    "flags",
    "tags",
    "meta",
    "created_at",
    "updated_at",
}


# --- WEBHOOK EVENT TYPES --------------------------------------------------- #


class WebhookEventType(str, Enum):
    """Subscribable event types — a strict subset of EventType.

    Values are derived from EventType so the strings stay in sync.
    To add a new subscribable event type, it must first exist in EventType.
    """

    ENVIRONMENTS_REVISIONS_COMMITTED = EventType.ENVIRONMENTS_REVISIONS_COMMITTED.value
    WEBHOOKS_SUBSCRIPTIONS_TESTED = EventType.WEBHOOKS_SUBSCRIPTIONS_TESTED.value

    @classmethod
    def values(cls) -> List[str]:
        return [e.value for e in cls]


# --- WEBHOOK SUBSCRIPTIONS -------------------------------------------------- #


class WebhookSubscriptionFlags(BaseModel):
    is_valid: bool = False


class WebhookSubscriptionQueryFlags(BaseModel):
    is_valid: Optional[bool] = None


class WebhookSubscriptionData(BaseModel):
    url: HttpUrl
    headers: Optional[Dict[str, str]] = None
    payload_fields: Optional[Dict[str, Any]] = None
    auth_mode: Optional[Literal["signature", "authorization"]] = None

    event_types: Optional[List[WebhookEventType]] = None


class WebhookSubscription(Identifier, Lifecycle, Header, Metadata):
    flags: Optional[WebhookSubscriptionFlags] = None

    data: WebhookSubscriptionData

    secret_id: Optional[UUID] = None
    secret: Optional[str] = None


class WebhookSubscriptionCreate(Header, Metadata):
    flags: Optional[WebhookSubscriptionFlags] = None

    data: WebhookSubscriptionData

    secret: Optional[str] = None


class WebhookSubscriptionEdit(Identifier, Lifecycle, Header, Metadata):
    flags: Optional[WebhookSubscriptionFlags] = None

    data: WebhookSubscriptionData

    secret: Optional[str] = None


class WebhookSubscriptionQuery(Header, Metadata):
    flags: Optional[WebhookSubscriptionQueryFlags] = None


# --- WEBHOOK DELIVERIES ----------------------------------------------------- #


class WebhookDeliveryResponseInfo(BaseModel):
    status_code: Optional[int] = None
    body: Optional[str] = None


class WebhookDeliveryData(BaseModel):
    event_type: Optional[WebhookEventType] = None

    url: HttpUrl
    headers: Optional[Dict[str, str]] = None
    payload: Optional[Dict[str, Any]] = None

    response: Optional[WebhookDeliveryResponseInfo] = None

    error: Optional[str] = None


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
