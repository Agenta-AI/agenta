from sqlalchemy import (
    Column,
    ForeignKeyConstraint,
    Index,
    Integer,
    PrimaryKeyConstraint,
    String,
    TIMESTAMP,
    UUID,
    text,
)
from sqlalchemy.dialects.postgresql import JSONB

from oss.src.dbs.postgres.shared.base import Base
from oss.src.dbs.postgres.shared.dbas import (
    IdentifierDBA,
    LifecycleDBA,
    ProjectScopeDBA,
)


class NotificationDBE(Base, ProjectScopeDBA, IdentifierDBA, LifecycleDBA):
    __tablename__ = "notifications"

    __table_args__ = (
        PrimaryKeyConstraint("project_id", "id"),
        ForeignKeyConstraint(
            ["project_id"],
            ["projects.id"],
            ondelete="CASCADE",
        ),
        Index(
            "uq_notifications_project_id_dedup_key_open",
            "project_id",
            "dedup_key",
            unique=True,
            postgresql_where=text("state = 'open'"),
        ),
    )

    kind = Column(String, nullable=False)
    dedup_key = Column(String, nullable=False)
    state = Column(String, nullable=False)
    data = Column(JSONB(none_as_null=True), nullable=False)


class NotificationDeliveryDBE(Base, ProjectScopeDBA, IdentifierDBA, LifecycleDBA):
    __tablename__ = "notification_deliveries"

    __table_args__ = (
        PrimaryKeyConstraint("project_id", "id"),
        ForeignKeyConstraint(
            ["project_id"],
            ["projects.id"],
            ondelete="CASCADE",
        ),
        Index(
            "uq_notification_deliveries_notification_id_user_id_channel",
            "project_id",
            "notification_id",
            "user_id",
            "channel",
            unique=True,
        ),
        Index(
            "ix_notification_deliveries_created_project_id_created_at",
            "project_id",
            "created_at",
            postgresql_where=text("state = 'created'"),
        ),
    )

    notification_id = Column(UUID(as_uuid=True), nullable=False)
    user_id = Column(UUID(as_uuid=True), nullable=False)
    channel = Column(String, nullable=False)
    state = Column(String, nullable=False)
    attempt_count = Column(Integer, nullable=False, default=0, server_default=text("0"))
    sent_at = Column(TIMESTAMP(timezone=True), nullable=True)
