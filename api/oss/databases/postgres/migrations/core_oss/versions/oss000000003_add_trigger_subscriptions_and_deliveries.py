"""add trigger_subscriptions, trigger_schedules and trigger_deliveries tables

The heart of the gateway-triggers domain, modeled on
webhook_subscriptions + webhook_deliveries. A subscription FKs the shared
gateway_connections row (many subscriptions per connection); a schedule is the
cron-driven analogue with no connection; a delivery dedups on the event id
(metadata.id for subscriptions, the tick id for schedules) per parent (I4) and
belongs to exactly one parent (XOR). Authored once in the shared core_oss chain
so it runs in BOTH editions.

Revision ID: oss000000003
Revises: oss000000002
Create Date: 2026-06-18 00:00:01.000000

"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


# revision identifiers, used by Alembic.
revision: str = "oss000000003"
down_revision: Union[str, None] = "oss000000002"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # -- TRIGGER SUBSCRIPTIONS --------------------------------------------------
    op.create_table(
        "trigger_subscriptions",
        sa.Column("project_id", sa.UUID(), nullable=False),
        sa.Column("id", sa.UUID(), nullable=False),
        sa.Column("connection_id", sa.UUID(), nullable=False),
        sa.Column("trigger_id", sa.String(), nullable=True),
        sa.Column("name", sa.String(), nullable=True),
        sa.Column("description", sa.String(), nullable=True),
        sa.Column("data", postgresql.JSON(astext_type=sa.Text()), nullable=True),
        sa.Column(
            "flags",
            postgresql.JSONB(none_as_null=True, astext_type=sa.Text()),
            nullable=True,
        ),
        sa.Column("meta", postgresql.JSON(astext_type=sa.Text()), nullable=True),
        sa.Column(
            "tags",
            postgresql.JSONB(none_as_null=True, astext_type=sa.Text()),
            nullable=True,
        ),
        sa.Column(
            "created_at",
            sa.TIMESTAMP(timezone=True),
            server_default=sa.text("CURRENT_TIMESTAMP"),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.TIMESTAMP(timezone=True),
            server_onupdate=sa.text("CURRENT_TIMESTAMP"),
            nullable=True,
        ),
        sa.Column("deleted_at", sa.TIMESTAMP(timezone=True), nullable=True),
        sa.Column("created_by_id", sa.UUID(), nullable=True),
        sa.Column("updated_by_id", sa.UUID(), nullable=True),
        sa.Column("deleted_by_id", sa.UUID(), nullable=True),
        sa.ForeignKeyConstraint(["project_id"], ["projects.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(
            ["project_id", "connection_id"],
            ["gateway_connections.project_id", "gateway_connections.id"],
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("project_id", "id"),
    )

    op.create_index(
        "ix_trigger_subscriptions_project_id_created_at",
        "trigger_subscriptions",
        ["project_id", "created_at"],
        unique=False,
    )
    op.create_index(
        "ix_trigger_subscriptions_project_id_deleted_at",
        "trigger_subscriptions",
        ["project_id", "deleted_at"],
        unique=False,
    )
    op.create_index(
        "ix_trigger_subscriptions_connection_id",
        "trigger_subscriptions",
        ["project_id", "connection_id"],
        unique=False,
    )
    op.create_index(
        "ix_trigger_subscriptions_trigger_id",
        "trigger_subscriptions",
        ["project_id", "trigger_id"],
        unique=True,
        postgresql_where=sa.text("trigger_id IS NOT NULL AND deleted_at IS NULL"),
    )

    # -- TRIGGER SCHEDULES ------------------------------------------------------
    op.create_table(
        "trigger_schedules",
        sa.Column("project_id", sa.UUID(), nullable=False),
        sa.Column("id", sa.UUID(), nullable=False),
        sa.Column("name", sa.String(), nullable=True),
        sa.Column("description", sa.String(), nullable=True),
        sa.Column("data", postgresql.JSON(astext_type=sa.Text()), nullable=True),
        sa.Column(
            "flags",
            postgresql.JSONB(none_as_null=True, astext_type=sa.Text()),
            nullable=True,
        ),
        sa.Column("meta", postgresql.JSON(astext_type=sa.Text()), nullable=True),
        sa.Column(
            "tags",
            postgresql.JSONB(none_as_null=True, astext_type=sa.Text()),
            nullable=True,
        ),
        sa.Column(
            "created_at",
            sa.TIMESTAMP(timezone=True),
            server_default=sa.text("CURRENT_TIMESTAMP"),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.TIMESTAMP(timezone=True),
            server_onupdate=sa.text("CURRENT_TIMESTAMP"),
            nullable=True,
        ),
        sa.Column("deleted_at", sa.TIMESTAMP(timezone=True), nullable=True),
        sa.Column("created_by_id", sa.UUID(), nullable=True),
        sa.Column("updated_by_id", sa.UUID(), nullable=True),
        sa.Column("deleted_by_id", sa.UUID(), nullable=True),
        sa.ForeignKeyConstraint(["project_id"], ["projects.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("project_id", "id"),
    )

    op.create_index(
        "ix_trigger_schedules_project_id_created_at",
        "trigger_schedules",
        ["project_id", "created_at"],
        unique=False,
    )
    op.create_index(
        "ix_trigger_schedules_project_id_deleted_at",
        "trigger_schedules",
        ["project_id", "deleted_at"],
        unique=False,
    )
    op.create_index(
        "ix_trigger_schedules_active",
        "trigger_schedules",
        ["project_id"],
        unique=False,
        postgresql_where=sa.text(
            "(flags ->> 'is_active') = 'true' AND deleted_at IS NULL"
        ),
    )

    # -- TRIGGER DELIVERIES -----------------------------------------------------
    op.create_table(
        "trigger_deliveries",
        sa.Column("project_id", sa.UUID(), nullable=False),
        sa.Column("id", sa.UUID(), nullable=False),
        sa.Column("subscription_id", sa.UUID(), nullable=True),
        sa.Column("schedule_id", sa.UUID(), nullable=True),
        sa.Column("event_id", sa.String(), nullable=False),
        sa.Column(
            "status",
            postgresql.JSONB(none_as_null=True, astext_type=sa.Text()),
            nullable=True,
        ),
        sa.Column("data", postgresql.JSON(astext_type=sa.Text()), nullable=True),
        sa.Column(
            "created_at",
            sa.TIMESTAMP(timezone=True),
            server_default=sa.text("CURRENT_TIMESTAMP"),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.TIMESTAMP(timezone=True),
            server_onupdate=sa.text("CURRENT_TIMESTAMP"),
            nullable=True,
        ),
        sa.Column("deleted_at", sa.TIMESTAMP(timezone=True), nullable=True),
        sa.Column("created_by_id", sa.UUID(), nullable=True),
        sa.Column("updated_by_id", sa.UUID(), nullable=True),
        sa.Column("deleted_by_id", sa.UUID(), nullable=True),
        sa.ForeignKeyConstraint(["project_id"], ["projects.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(
            ["project_id", "subscription_id"],
            ["trigger_subscriptions.project_id", "trigger_subscriptions.id"],
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["project_id", "schedule_id"],
            ["trigger_schedules.project_id", "trigger_schedules.id"],
            ondelete="CASCADE",
        ),
        sa.CheckConstraint(
            "(subscription_id IS NULL) <> (schedule_id IS NULL)",
            name="ck_trigger_deliveries_exactly_one_parent",
        ),
        sa.PrimaryKeyConstraint("project_id", "id"),
    )

    op.create_index(
        "ix_trigger_deliveries_project_id_created_at",
        "trigger_deliveries",
        ["project_id", "created_at"],
        unique=False,
    )
    op.create_index(
        "ix_trigger_deliveries_subscription_id_created_at",
        "trigger_deliveries",
        ["subscription_id", "created_at"],
        unique=False,
    )
    op.create_index(
        "ix_trigger_deliveries_schedule_id_created_at",
        "trigger_deliveries",
        ["schedule_id", "created_at"],
        unique=False,
    )
    op.create_index(
        "ix_trigger_deliveries_subscription_id_event_id",
        "trigger_deliveries",
        ["project_id", "subscription_id", "event_id"],
        unique=True,
        postgresql_where=sa.text("subscription_id IS NOT NULL"),
    )
    op.create_index(
        "ix_trigger_deliveries_schedule_id_event_id",
        "trigger_deliveries",
        ["project_id", "schedule_id", "event_id"],
        unique=True,
        postgresql_where=sa.text("schedule_id IS NOT NULL"),
    )


def downgrade() -> None:
    op.drop_index(
        "ix_trigger_deliveries_schedule_id_event_id",
        table_name="trigger_deliveries",
    )
    op.drop_index(
        "ix_trigger_deliveries_subscription_id_event_id",
        table_name="trigger_deliveries",
    )
    op.drop_index(
        "ix_trigger_deliveries_schedule_id_created_at",
        table_name="trigger_deliveries",
    )
    op.drop_index(
        "ix_trigger_deliveries_subscription_id_created_at",
        table_name="trigger_deliveries",
    )
    op.drop_index(
        "ix_trigger_deliveries_project_id_created_at",
        table_name="trigger_deliveries",
    )
    op.drop_table("trigger_deliveries")

    op.drop_index(
        "ix_trigger_schedules_active",
        table_name="trigger_schedules",
    )
    op.drop_index(
        "ix_trigger_schedules_project_id_deleted_at",
        table_name="trigger_schedules",
    )
    op.drop_index(
        "ix_trigger_schedules_project_id_created_at",
        table_name="trigger_schedules",
    )
    op.drop_table("trigger_schedules")

    op.drop_index(
        "ix_trigger_subscriptions_trigger_id",
        table_name="trigger_subscriptions",
    )
    op.drop_index(
        "ix_trigger_subscriptions_connection_id",
        table_name="trigger_subscriptions",
    )
    op.drop_index(
        "ix_trigger_subscriptions_project_id_deleted_at",
        table_name="trigger_subscriptions",
    )
    op.drop_index(
        "ix_trigger_subscriptions_project_id_created_at",
        table_name="trigger_subscriptions",
    )
    op.drop_table("trigger_subscriptions")
