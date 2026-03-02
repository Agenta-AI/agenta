from sqlalchemy import ForeignKeyConstraint, Index, PrimaryKeyConstraint

from oss.src.dbs.postgres.shared.base import Base
from oss.src.dbs.postgres.webhooks.dbas import (
    WebhookDeliveryDBA,
    WebhookSubscriptionDBA,
)


class WebhookSubscriptionDBE(Base, WebhookSubscriptionDBA):
    __tablename__ = "webhook_subscriptions"

    __table_args__ = (
        ForeignKeyConstraint(
            ["project_id"],
            ["projects.id"],
            ondelete="CASCADE",
        ),
        ForeignKeyConstraint(
            ["created_by_id"],
            ["users.id"],
        ),
        ForeignKeyConstraint(
            ["secret_id"],
            ["secrets.id"],
            ondelete="SET NULL",
        ),
        PrimaryKeyConstraint("project_id", "id"),
        Index(
            "ix_webhook_subscriptions_project_id_created_at",
            "project_id",
            "created_at",
        ),
        Index(
            "ix_webhook_subscriptions_project_id_deleted_at",
            "project_id",
            "deleted_at",
        ),
    )


class WebhookDeliveryDBE(Base, WebhookDeliveryDBA):
    __tablename__ = "webhook_deliveries"

    __table_args__ = (
        PrimaryKeyConstraint("project_id", "id"),
        Index(
            "ix_webhook_deliveries_project_id_created_at",
            "project_id",
            "created_at",
        ),
        Index(
            "ix_webhook_deliveries_status_created_at",
            "status",
            "created_at",
        ),
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
            "ix_webhook_deliveries_subscription_id_event_id",
            "project_id",
            "subscription_id",
            "event_id",
            unique=True,
        ),
    )
