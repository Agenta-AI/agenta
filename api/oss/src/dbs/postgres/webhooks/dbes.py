"""Database entities for webhooks."""

from sqlalchemy import ForeignKey, Column
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import relationship

from oss.src.dbs.postgres.shared.base import Base
from oss.src.core.webhooks.config import WEBHOOK_MAX_RETRIES
from oss.src.dbs.postgres.webhooks.dbas import (
    WebhookSubscriptionDBA,
    WebhookDeliveryDBA,
)


class WebhookSubscriptionDBE(Base, WebhookSubscriptionDBA):
    """Webhook subscription DB entity."""

    __tablename__ = "webhook_subscriptions"

    project_id = Column(
        UUID(as_uuid=True),
        ForeignKey("projects.id", ondelete="CASCADE"),
        nullable=False,
    )
    created_by_id = Column(
        UUID(as_uuid=True),
        ForeignKey("users.id", ondelete="SET NULL"),
        nullable=True,
    )

    project = relationship(
        "oss.src.models.db_models.ProjectDB",
    )
    created_by = relationship(
        "oss.src.models.db_models.UserDB",
    )


class WebhookDeliveryDBE(Base, WebhookDeliveryDBA):
    """Webhook delivery DB entity."""

    __tablename__ = "webhook_deliveries"

    subscription_id = Column(
        UUID(as_uuid=True),
        ForeignKey("webhook_subscriptions.id", ondelete="CASCADE"),
        nullable=False,
    )

    # Set default for max_attempts from config
    def __init__(self, *args, **kwargs):
        if "max_attempts" not in kwargs:
            kwargs["max_attempts"] = WEBHOOK_MAX_RETRIES
        super().__init__(*args, **kwargs)

    subscription = relationship(
        "WebhookSubscriptionDBE",
    )
