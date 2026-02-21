"""Abstract base classes for webhook database entities."""

import uuid_utils.compat as uuid
from sqlalchemy import Column, String, Integer, Boolean, DateTime, Text
from sqlalchemy.dialects.postgresql import UUID, ARRAY, JSONB
from datetime import datetime, timezone


class WebhookSubscriptionDBA:
    """Abstract base for webhook subscription."""

    __abstract__ = True

    id = Column(
        UUID(as_uuid=True),
        primary_key=True,
        default=uuid.uuid7,
        unique=True,
        nullable=False,
    )
    name = Column(String(255), nullable=False)
    url = Column(String(2048), nullable=False)
    events = Column(ARRAY(String), nullable=False, default=list)
    secret = Column(String(128), nullable=False)
    is_active = Column(Boolean, default=True, nullable=False)
    meta = Column(JSONB, nullable=True)
    created_at = Column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc)
    )
    updated_at = Column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc)
    )
    created_by_id = Column(UUID(as_uuid=True), nullable=True)
    archived_at = Column(DateTime(timezone=True), nullable=True)


class WebhookDeliveryDBA:
    """Abstract base for webhook delivery (append-only).

    Each HTTP delivery attempt creates one immutable record.
    Records are NEVER updated after creation.
    Retry attempts are grouped by delivery_id.
    """

    __abstract__ = True

    id = Column(
        UUID(as_uuid=True),
        primary_key=True,
        default=uuid.uuid7,
        unique=True,
        nullable=False,
    )
    delivery_id = Column(UUID(as_uuid=True), nullable=False, index=True)
    event_type = Column(String(100), nullable=False)
    payload = Column(JSONB, nullable=False)
    attempt_number = Column(Integer, nullable=False, default=1)
    max_attempts = Column(Integer, nullable=False)
    status = Column(String(20), nullable=False)
    status_code = Column(Integer, nullable=True)
    response_body = Column(Text, nullable=True)
    error_message = Column(Text, nullable=True)
    duration_ms = Column(Integer, nullable=True)
    url = Column(String(2048), nullable=False)
    delivered_at = Column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc)
    )
