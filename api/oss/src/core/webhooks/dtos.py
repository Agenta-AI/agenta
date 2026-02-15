"""Data transfer objects for webhooks domain."""

from datetime import datetime
from typing import List, Optional
from uuid import UUID
from pydantic import BaseModel, Field, HttpUrl


# Request DTOs (used by service layer)
class CreateWebhookSubscriptionDTO(BaseModel):
    """DTO for creating a webhook subscription."""

    name: str = Field(..., max_length=255)
    url: HttpUrl
    events: List[str]
    is_active: bool = True
    meta: Optional[dict] = None


class UpdateWebhookSubscriptionDTO(BaseModel):
    """DTO for updating a webhook subscription."""

    name: Optional[str] = Field(None, max_length=255)
    url: Optional[HttpUrl] = None
    events: Optional[List[str]] = None
    is_active: Optional[bool] = None
    meta: Optional[dict] = None


# Response DTOs (returned by service/DAO)
class WebhookSubscriptionResponseDTO(BaseModel):
    """DTO for webhook subscription responses."""

    id: UUID
    workspace_id: UUID
    name: str
    url: str  # Stored as string in DB
    events: List[str]
    secret: str
    is_active: bool
    meta: Optional[dict]
    created_at: datetime
    updated_at: datetime
    created_by_id: Optional[UUID]
    archived_at: Optional[datetime] = None


class WebhookDeliveryResponseDTO(BaseModel):
    """DTO for webhook delivery responses."""

    id: UUID
    subscription_id: UUID
    event_type: str
    payload: dict
    status: str
    attempts: int
    max_attempts: int
    next_retry_at: Optional[datetime]
    response_status_code: Optional[int]
    response_body: Optional[str]
    error_message: Optional[str]
    duration_ms: Optional[int]
    created_at: datetime
    delivered_at: Optional[datetime]
    failed_at: Optional[datetime]


class WebhookSubscriptionQueryDTO(BaseModel):
    """Filter criteria for querying webhook subscriptions."""

    is_active: Optional[bool] = None
    events: Optional[List[str]] = None
    created_after: Optional[datetime] = None
    created_before: Optional[datetime] = None
    sort_by: str = "created_at"
    sort_order: str = "desc"
