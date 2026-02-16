"""API request and response models for webhooks endpoints."""

from datetime import datetime
from typing import List, Optional
from uuid import UUID

from pydantic import BaseModel, Field, HttpUrl


# Request Models (API layer)
class CreateWebhookSubscriptionRequest(BaseModel):
    """API request model for creating webhook subscription."""

    name: str = Field(..., max_length=255)
    url: HttpUrl
    events: List[str]
    is_active: bool = True
    meta: Optional[dict] = None


class UpdateWebhookSubscriptionRequest(BaseModel):
    """API request model for updating webhook subscription."""

    name: Optional[str] = Field(None, max_length=255)
    url: Optional[HttpUrl] = None
    events: Optional[List[str]] = None
    is_active: Optional[bool] = None
    meta: Optional[dict] = None


# Response Models (API layer)
class WebhookSubscriptionResponse(BaseModel):
    """API response model for webhook subscription."""

    id: UUID
    project_id: UUID
    name: str
    url: str
    events: List[str]
    secret: str
    is_active: bool
    meta: Optional[dict]
    created_at: datetime
    updated_at: datetime
    archived_at: Optional[datetime] = None
    created_by_id: Optional[UUID]


class WebhookDeliveryResponse(BaseModel):
    """API response model for webhook delivery."""

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


# Test Models
class TestWebhookRequest(BaseModel):
    """API request model for testing webhook."""

    url: HttpUrl
    event_type: str = "config.deployed"


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
