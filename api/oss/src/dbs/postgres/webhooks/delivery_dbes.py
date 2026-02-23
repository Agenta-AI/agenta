"""Database entities for webhook deliveries (tracing database)."""

from sqlalchemy import Index, PrimaryKeyConstraint

from oss.src.dbs.postgres.shared.base import Base
from oss.src.dbs.postgres.webhooks.dbas import WebhookDeliveryDBA


class WebhookDeliveryDBE(Base, WebhookDeliveryDBA):
    """Webhook delivery DB entity (tracing database)."""

    __tablename__ = "webhook_deliveries"

    __table_args__ = (
        PrimaryKeyConstraint("id"),
        Index(
            "ix_webhook_deliveries_subscription_id_created_at",
            "subscription_id",
            "created_at",
        ),
        Index(
            "ix_webhook_deliveries_event_id_created_at",
            "event_id",
            "created_at",
        ),
        Index(
            "ix_webhook_deliveries_status_created_at",
            "status",
            "created_at",
        ),
        Index(
            "ix_webhook_deliveries_subscription_id_event_id",
            "subscription_id",
            "event_id",
        ),
    )
