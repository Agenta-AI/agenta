"""add webhook_subscriptions and webhook_deliveries tables

Revision ID: f0a1b2c3d4e5
Revises: d4e5f6a7b8c9
Create Date: 2026-03-01 00:01:00.000000

"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision: str = "f0a1b2c3d4e5"
down_revision: Union[str, None] = "d4e5f6a7b8c9"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # -- WEBHOOK SUBSCRIPTIONS --------------------------------------------------
    op.create_table(
        "webhook_subscriptions",
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
        sa.Column("created_by_id", sa.UUID(), nullable=False),
        sa.Column("updated_by_id", sa.UUID(), nullable=True),
        sa.Column("deleted_by_id", sa.UUID(), nullable=True),
        sa.Column("secret_id", sa.UUID(), nullable=True),
        sa.ForeignKeyConstraint(["project_id"], ["projects.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["created_by_id"], ["users.id"]),
        sa.ForeignKeyConstraint(["secret_id"], ["secrets.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
    )

    op.create_index(
        "ix_webhook_subscriptions_project_id_created_at",
        "webhook_subscriptions",
        ["project_id", "created_at"],
        unique=False,
    )
    op.create_index(
        "ix_webhook_subscriptions_project_id_deleted_at",
        "webhook_subscriptions",
        ["project_id", "deleted_at"],
        unique=False,
    )

    # -- WEBHOOK DELIVERIES -----------------------------------------------------
    op.create_table(
        "webhook_deliveries",
        sa.Column("project_id", sa.UUID(), nullable=False),
        sa.Column("id", sa.UUID(), nullable=False),
        sa.Column("subscription_id", sa.UUID(), nullable=False),
        sa.Column("event_id", sa.UUID(), nullable=False),
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
        sa.PrimaryKeyConstraint("id"),
    )

    op.create_index(
        "ix_webhook_deliveries_project_id_created_at",
        "webhook_deliveries",
        ["project_id", "created_at"],
        unique=False,
    )
    op.create_index(
        "ix_webhook_deliveries_subscription_id_created_at",
        "webhook_deliveries",
        ["subscription_id", "created_at"],
        unique=False,
    )
    op.create_index(
        "ix_webhook_deliveries_event_id_created_at",
        "webhook_deliveries",
        ["event_id", "created_at"],
        unique=False,
    )
    op.create_index(
        "ix_webhook_deliveries_status_created_at",
        "webhook_deliveries",
        ["status", "created_at"],
        unique=False,
    )
    op.create_index(
        "ix_webhook_deliveries_subscription_id_event_id",
        "webhook_deliveries",
        ["project_id", "subscription_id", "event_id"],
        unique=True,
    )


def downgrade() -> None:
    op.drop_index(
        "ix_webhook_deliveries_subscription_id_event_id",
        table_name="webhook_deliveries",
    )
    op.drop_index(
        "ix_webhook_deliveries_status_created_at",
        table_name="webhook_deliveries",
    )
    op.drop_index(
        "ix_webhook_deliveries_event_id_created_at",
        table_name="webhook_deliveries",
    )
    op.drop_index(
        "ix_webhook_deliveries_subscription_id_created_at",
        table_name="webhook_deliveries",
    )
    op.drop_index(
        "ix_webhook_deliveries_project_id_created_at",
        table_name="webhook_deliveries",
    )
    op.drop_table("webhook_deliveries")

    op.drop_index(
        "ix_webhook_subscriptions_project_id_deleted_at",
        table_name="webhook_subscriptions",
    )
    op.drop_index(
        "ix_webhook_subscriptions_project_id_created_at",
        table_name="webhook_subscriptions",
    )
    op.drop_table("webhook_subscriptions")
