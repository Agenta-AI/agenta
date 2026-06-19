from sqlalchemy import ForeignKeyConstraint, Index, PrimaryKeyConstraint

from oss.src.dbs.postgres.shared.base import Base
from oss.src.dbs.postgres.triggers.dbas import (
    TriggerDeliveryDBA,
    TriggerSubscriptionDBA,
)


class TriggerSubscriptionDBE(Base, TriggerSubscriptionDBA):
    __tablename__ = "trigger_subscriptions"

    __table_args__ = (
        ForeignKeyConstraint(
            ["project_id"],
            ["projects.id"],
            ondelete="CASCADE",
        ),
        ForeignKeyConstraint(
            ["project_id", "connection_id"],
            ["gateway_connections.project_id", "gateway_connections.id"],
            ondelete="CASCADE",
        ),
        PrimaryKeyConstraint("project_id", "id"),
        Index(
            "ix_trigger_subscriptions_project_id_created_at",
            "project_id",
            "created_at",
        ),
        Index(
            "ix_trigger_subscriptions_project_id_deleted_at",
            "project_id",
            "deleted_at",
        ),
        Index(
            "ix_trigger_subscriptions_connection_id",
            "project_id",
            "connection_id",
        ),
    )


class TriggerDeliveryDBE(Base, TriggerDeliveryDBA):
    __tablename__ = "trigger_deliveries"

    __table_args__ = (
        ForeignKeyConstraint(
            ["project_id"],
            ["projects.id"],
            ondelete="CASCADE",
        ),
        ForeignKeyConstraint(
            ["project_id", "subscription_id"],
            ["trigger_subscriptions.project_id", "trigger_subscriptions.id"],
            ondelete="CASCADE",
        ),
        PrimaryKeyConstraint("project_id", "id"),
        Index(
            "ix_trigger_deliveries_project_id_created_at",
            "project_id",
            "created_at",
        ),
        Index(
            "ix_trigger_deliveries_subscription_id_created_at",
            "subscription_id",
            "created_at",
        ),
        Index(
            "ix_trigger_deliveries_subscription_id_event_id",
            "project_id",
            "subscription_id",
            "event_id",
            unique=True,
        ),
    )
