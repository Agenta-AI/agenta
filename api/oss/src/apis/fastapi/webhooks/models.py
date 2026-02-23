"""API request and response models for webhooks endpoints."""

from datetime import datetime
from typing import Any, Dict, List, Optional
from uuid import UUID

from pydantic import BaseModel, Field, HttpUrl


# Request Models (API layer)
class CreateWebhookSubscriptionRequest(BaseModel):
    """API request model for creating webhook subscription."""

    name: str = Field(..., max_length=255)
    url: HttpUrl
    events: List[str]
    headers: Optional[Dict[str, str]] = None
    is_active: bool = True
    meta: Optional[dict] = None
    tags: Optional[dict] = None


class UpdateWebhookSubscriptionRequest(BaseModel):
    """API request model for updating webhook subscription."""

    name: Optional[str] = Field(None, max_length=255)
    url: Optional[HttpUrl] = None
    events: Optional[List[str]] = None
    headers: Optional[Dict[str, str]] = None
    is_active: Optional[bool] = None
    meta: Optional[dict] = None
    tags: Optional[dict] = None


# Response Models (API layer)
class WebhookSubscriptionResponse(BaseModel):
    """API response model for webhook subscription."""

    id: UUID
    project_id: UUID
    name: str
    url: str
    events: List[str]
    headers: Optional[Dict[str, str]] = None
    secret_id: Optional[UUID]
    is_active: bool
    flags: Optional[dict] = None
    meta: Optional[dict]
    tags: Optional[dict] = None
    created_at: datetime
    updated_at: Optional[datetime]
    archived_at: Optional[datetime] = None
    created_by_id: Optional[UUID]
    updated_by_id: Optional[UUID] = None
    deleted_by_id: Optional[UUID] = None


class WebhookDeliveryResponse(BaseModel):
    """API response model for webhook delivery."""

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


# Test Models
class TestWebhookRequest(BaseModel):
    """API request model for testing webhook."""

    url: HttpUrl
    event_type: str = "config.deployed"
    subscription_id: Optional[UUID] = None


class TestWebhookResponse(BaseModel):
    """API response model for webhook test."""

    success: bool
    status_code: Optional[int]
    response_body: Optional[str]
    duration_ms: int
    test_secret: str
    signature_format: str
    signing_payload: Optional[str] = None


# Query Models
class WebhookSubscriptionQueryRequest(BaseModel):
    """POST /webhooks/query request body."""

    # Filters (project_id always from request.state, never from body)
    is_active: Optional[bool] = None
    events: Optional[List[str]] = None
    created_after: Optional[datetime] = None
    created_before: Optional[datetime] = None
    # Sorting
    sort_by: Optional[str] = Field(
        default="created_at", pattern="^(created_at|updated_at|name)$"
    )
    sort_order: Optional[str] = Field(default="desc", pattern="^(asc|desc)$")
    # Pagination (with defaults)
    offset: int = Field(default=0, ge=0)
    limit: int = Field(default=20, ge=1, le=100)


class WebhookSubscriptionsResponse(BaseModel):
    """Envelope response for subscription queries."""

    count: int = 0
    data: List[WebhookSubscriptionResponse] = []
    offset: int = 0
    limit: int = 20
