from datetime import datetime
from typing import List, Optional
from uuid import UUID

from pydantic import BaseModel, Field, HttpUrl


class WebhookSubscriptionBase(BaseModel):
    name: str = Field(..., max_length=255)
    url: HttpUrl
    events: List[str]
    is_active: bool = True
    meta: Optional[dict] = None


class CreateWebhookSubscription(WebhookSubscriptionBase):
    pass


class UpdateWebhookSubscription(BaseModel):
    name: Optional[str] = Field(None, max_length=255)
    url: Optional[HttpUrl] = None
    events: Optional[List[str]] = None
    is_active: Optional[bool] = None
    meta: Optional[dict] = None


class WebhookSubscription(WebhookSubscriptionBase):
    id: UUID
    workspace_id: UUID
    secret: str
    created_at: datetime
    updated_at: datetime
    created_by_id: Optional[UUID]

    class Config:
        from_attributes = True


class WebhookDelivery(BaseModel):
    id: UUID
    subscription_id: UUID
    event_id: Optional[UUID]
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

    class Config:
        from_attributes = True


class TestWebhookPayload(BaseModel):
    url: HttpUrl
    event_type: str = "config.deployed"


class TestWebhookResponse(BaseModel):
    success: bool
    status_code: Optional[int]
    response_body: Optional[str]
    duration_ms: int
    test_secret: str
    signature_format: str
    signing_payload: Optional[str] = None
