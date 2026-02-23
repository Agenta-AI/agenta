"""Database entities for webhook subscriptions (core database)."""

from sqlalchemy import ForeignKeyConstraint, PrimaryKeyConstraint
from sqlalchemy.orm import relationship

from oss.src.dbs.postgres.shared.base import Base
from oss.src.dbs.postgres.webhooks.dbas import WebhookSubscriptionDBA


class WebhookSubscriptionDBE(Base, WebhookSubscriptionDBA):
    """Webhook subscription DB entity."""

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
        PrimaryKeyConstraint("id"),
    )

    project = relationship(
        "oss.src.models.db_models.ProjectDB",
    )
    created_by = relationship(
        "oss.src.models.db_models.UserDB",
    )
