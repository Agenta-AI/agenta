"""Database entities for webhooks."""

from sqlalchemy import ForeignKey, Column
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import relationship

from oss.src.dbs.postgres.shared.base import Base
from oss.src.dbs.postgres.webhooks.dbas import (
    WebhookSubscriptionDBA,
    WebhookEventDBA,
    WebhookDeliveryDBA,
)
from oss.src.core.webhooks.config import WEBHOOK_MAX_RETRIES


class WebhookSubscriptionDBE(Base, WebhookSubscriptionDBA):
    """Webhook subscription DB entity."""

    __tablename__ = "webhook_subscriptions"

    workspace_id = Column(
        UUID(as_uuid=True),
        ForeignKey("workspaces.id", ondelete="CASCADE"),
        nullable=False,
    )
    created_by_id = Column(
        UUID(as_uuid=True),
        ForeignKey("users.id", ondelete="SET NULL"),
        nullable=True,
    )

    workspace = relationship(
        "oss.src.models.db_models.WorkspaceDB",
    )
    created_by = relationship(
        "oss.src.models.db_models.UserDB",
    )


class WebhookEventDBE(Base, WebhookEventDBA):
    """Webhook event DB entity."""

    __tablename__ = "webhook_events"


class WebhookDeliveryDBE(Base, WebhookDeliveryDBA):
    """Webhook delivery DB entity."""

    __tablename__ = "webhook_deliveries"

    subscription_id = Column(
        UUID(as_uuid=True),
        ForeignKey("webhook_subscriptions.id", ondelete="CASCADE"),
        nullable=False,
    )
    event_id = Column(
        UUID(as_uuid=True),
        ForeignKey("webhook_events.id", ondelete="SET NULL"),
        nullable=True,
    )

    # Set default for max_attempts from config
    def __init__(self, *args, **kwargs):
        if "max_attempts" not in kwargs:
            kwargs["max_attempts"] = WEBHOOK_MAX_RETRIES
        super().__init__(*args, **kwargs)

    subscription = relationship(
        "oss.src.models.db_models.WebhookSubscriptionDB",
    )
    event = relationship(
        "oss.src.models.db_models.WebhookEventDB",
    )
