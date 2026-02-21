"""Database entities for webhooks (core database)."""

from sqlalchemy import ForeignKey, Column
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import relationship

from oss.src.dbs.postgres.shared.base import Base
from oss.src.dbs.postgres.webhooks.dbas import WebhookSubscriptionDBA


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
