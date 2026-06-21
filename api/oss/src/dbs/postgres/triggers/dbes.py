from sqlalchemy import (
    CheckConstraint,
    ForeignKeyConstraint,
    Index,
    PrimaryKeyConstraint,
    text,
)

from oss.src.dbs.postgres.shared.base import Base
from oss.src.dbs.postgres.triggers.dbas import (
    TriggerDeliveryDBA,
    TriggerScheduleDBA,
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
        Index(
            "ix_trigger_subscriptions_ti_id",
            "project_id",
            "ti_id",
            unique=True,
            postgresql_where=text("ti_id IS NOT NULL AND deleted_at IS NULL"),
        ),
    )


class TriggerScheduleDBE(Base, TriggerScheduleDBA):
    __tablename__ = "trigger_schedules"

    __table_args__ = (
        ForeignKeyConstraint(
            ["project_id"],
            ["projects.id"],
            ondelete="CASCADE",
        ),
        PrimaryKeyConstraint("project_id", "id"),
        Index(
            "ix_trigger_schedules_project_id_created_at",
            "project_id",
            "created_at",
        ),
        Index(
            "ix_trigger_schedules_project_id_deleted_at",
            "project_id",
            "deleted_at",
        ),
        Index(
            "ix_trigger_schedules_active",
            "project_id",
            postgresql_where=text(
                "(flags ->> 'is_active') = 'true' AND deleted_at IS NULL"
            ),
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
        ForeignKeyConstraint(
            ["project_id", "schedule_id"],
            ["trigger_schedules.project_id", "trigger_schedules.id"],
            ondelete="CASCADE",
        ),
        CheckConstraint(
            "(subscription_id IS NULL) <> (schedule_id IS NULL)",
            name="ck_trigger_deliveries_exactly_one_parent",
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
            postgresql_where=text("subscription_id IS NOT NULL"),
        ),
        Index(
            "ix_trigger_deliveries_schedule_id_event_id",
            "project_id",
            "schedule_id",
            "event_id",
            unique=True,
            postgresql_where=text("schedule_id IS NOT NULL"),
        ),
    )
