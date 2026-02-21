"""Database entities for webhook deliveries (tracing database).

Append-only: each HTTP delivery attempt creates one immutable record.
Records are NEVER updated after creation.
"""

from sqlalchemy import Column, Index
from sqlalchemy.dialects.postgresql import UUID

from oss.src.dbs.postgres.shared.base import Base
from oss.src.core.webhooks.config import WEBHOOK_MAX_RETRIES
from oss.src.dbs.postgres.webhooks.dbas import WebhookDeliveryDBA


class WebhookDeliveryDBE(Base, WebhookDeliveryDBA):
    """Webhook delivery DB entity (tracing database, append-only).

    Each HTTP delivery attempt creates one immutable record.
    Retry attempts are grouped by delivery_id.
    No ForeignKeys — subscription lives in core DB.
    """

    __tablename__ = "webhook_deliveries"

    # Plain UUID — no FK (subscription is in core DB)
    subscription_id = Column(UUID(as_uuid=True), nullable=False)

    __table_args__ = (
        Index(
            "ix_webhook_deliveries_delivery_id_attempt",
            "delivery_id",
            "attempt_number",
        ),
        Index(
            "ix_webhook_deliveries_subscription_id_delivered_at",
            "subscription_id",
            "delivered_at",
        ),
    )

    def __init__(self, *args, **kwargs):
        if "max_attempts" not in kwargs:
            kwargs["max_attempts"] = WEBHOOK_MAX_RETRIES
        super().__init__(*args, **kwargs)
