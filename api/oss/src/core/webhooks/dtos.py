"""Data transfer objects for webhooks domain."""

from datetime import datetime
from typing import Any, Dict, List, Optional
from uuid import UUID
from pydantic import BaseModel, Field, HttpUrl


# Request DTOs (used by service layer)
class CreateWebhookSubscriptionDTO(BaseModel):
    """DTO for creating a webhook subscription."""

    name: str = Field(..., max_length=255)
    url: HttpUrl
    events: List[str]
    headers: Optional[Dict[str, str]] = None
    is_active: bool = True
    meta: Optional[dict] = None
    tags: Optional[dict] = None


class UpdateWebhookSubscriptionDTO(BaseModel):
    """DTO for updating a webhook subscription."""

    name: Optional[str] = Field(None, max_length=255)
    url: Optional[HttpUrl] = None
    events: Optional[List[str]] = None
    headers: Optional[Dict[str, str]] = None
    is_active: Optional[bool] = None
    meta: Optional[dict] = None
    tags: Optional[dict] = None


# Response DTOs (returned by service/DAO)
class WebhookSubscriptionResponseDTO(BaseModel):
    """DTO for webhook subscription responses."""

    id: UUID
    project_id: UUID
    name: str
    url: str  # Stored as string in DB
    events: List[str]
    headers: Optional[Dict[str, str]] = None
    secret_id: Optional[UUID]
    is_active: bool
    flags: Optional[dict] = None
    meta: Optional[dict]
    tags: Optional[dict] = None
    created_at: datetime
    updated_at: Optional[datetime]
    created_by_id: Optional[UUID]
    updated_by_id: Optional[UUID] = None
    deleted_by_id: Optional[UUID] = None
    archived_at: Optional[datetime] = None


class WebhookDeliveryResponseDTO(BaseModel):
    """DTO for webhook delivery responses."""

    id: UUID
    subscription_id: UUID
    event_id: UUID
    status: str
    data: Optional[Dict[str, Any]] = None
    created_at: datetime
    updated_at: Optional[datetime] = None
    archived_at: Optional[datetime] = None
    created_by_id: Optional[UUID]
    updated_by_id: Optional[UUID] = None
    deleted_by_id: Optional[UUID] = None


class WebhookSubscriptionQueryDTO(BaseModel):
    """Filter criteria for querying webhook subscriptions."""

    is_active: Optional[bool] = None
    events: Optional[List[str]] = None
    created_after: Optional[datetime] = None
    created_before: Optional[datetime] = None
    sort_by: str = "created_at"
    sort_order: str = "desc"
