"""add webhook tables

Revision ID: 202602050000
Revises: fd77265d65dc
Create Date: 2026-02-05 02:30:00.000000

"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision: str = "202602050000"
down_revision: Union[str, None] = "a2b3c4d5e6f7"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Webhook Subscriptions (what users create)
    op.create_table(
        "webhook_subscriptions",
        sa.Column(
            "id",
            sa.UUID(),
            nullable=False,
        ),
        sa.Column(
            "workspace_id",
            sa.UUID(),
            nullable=False,
        ),
        sa.Column(
            "name",
            sa.String(255),
            nullable=False,
        ),
        sa.Column(
            "url",
            sa.String(2048),
            nullable=False,
        ),
        sa.Column(
            "events",
            postgresql.ARRAY(sa.String()),
            nullable=False,
            server_default="{}",
        ),
        sa.Column(
            "secret",
            sa.String(128),
            nullable=False,
        ),
        sa.Column(
            "is_active",
            sa.Boolean(),
            server_default=sa.text("true"),
            nullable=False,
        ),
        sa.Column(
            "meta",
            postgresql.JSONB(none_as_null=True),
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
            server_default=sa.text("CURRENT_TIMESTAMP"),
            nullable=True,
        ),
        sa.Column(
            "created_by_id",
            sa.UUID(),
            nullable=True,
        ),
        sa.Column(
            "archived_at",
            sa.TIMESTAMP(timezone=True),
            nullable=True,
        ),
        sa.PrimaryKeyConstraint("id"),
        sa.ForeignKeyConstraint(
            ["workspace_id"],
            ["workspaces.id"],
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["created_by_id"],
            ["users.id"],
            ondelete="SET NULL",
        ),
        sa.CheckConstraint(
            "url LIKE 'https://%' OR url LIKE 'http://localhost%' OR url LIKE 'http://127.0.0.1%'",
            name="chk_webhook_url_valid",
        ),
    )
    op.create_index(
        "ix_webhook_subscriptions_workspace_id",
        "webhook_subscriptions",
        ["workspace_id"],
        postgresql_where=sa.text("archived_at IS NULL"),
    )

    # Webhook Events (outbox pattern - temporary storage)
    op.create_table(
        "webhook_events",
        sa.Column(
            "id",
            sa.UUID(),
            nullable=False,
        ),
        sa.Column(
            "event_type",
            sa.String(100),
            nullable=False,
        ),
        sa.Column(
            "workspace_id",
            sa.UUID(),
            nullable=False,
        ),
        sa.Column(
            "payload",
            postgresql.JSONB(none_as_null=True),
            nullable=False,
        ),
        sa.Column(
            "created_at",
            sa.TIMESTAMP(timezone=True),
            server_default=sa.text("CURRENT_TIMESTAMP"),
            nullable=False,
        ),
        sa.Column(
            "processed",
            sa.Boolean(),
            server_default=sa.text("false"),
            nullable=False,
        ),
        sa.Column(
            "processed_at",
            sa.TIMESTAMP(timezone=True),
            nullable=True,
        ),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "ix_webhook_events_unprocessed",
        "webhook_events",
        ["created_at"],
        postgresql_where=sa.text("processed = false"),
    )

    # Webhook Deliveries (history of all delivery attempts)
    op.create_table(
        "webhook_deliveries",
        sa.Column(
            "id",
            sa.UUID(),
            nullable=False,
        ),
        sa.Column(
            "subscription_id",
            sa.UUID(),
            nullable=False,
        ),
        sa.Column(
            "event_id",
            sa.UUID(),
            nullable=True,
        ),
        sa.Column(
            "event_type",
            sa.String(100),
            nullable=False,
        ),
        sa.Column(
            "payload",
            postgresql.JSONB(none_as_null=True),
            nullable=False,
        ),
        sa.Column(
            "status",
            sa.String(20),
            server_default="pending",
            nullable=False,
        ),
        sa.Column(
            "attempts",
            sa.Integer(),
            server_default="0",
            nullable=False,
        ),
        sa.Column(
            "max_attempts",
            sa.Integer(),
            server_default="3",
            nullable=False,
        ),
        sa.Column(
            "next_retry_at",
            sa.TIMESTAMP(timezone=True),
            nullable=True,
        ),
        sa.Column(
            "response_status_code",
            sa.Integer(),
            nullable=True,
        ),
        sa.Column(
            "response_body",
            sa.Text(),
            nullable=True,
        ),
        sa.Column(
            "error_message",
            sa.Text(),
            nullable=True,
        ),
        sa.Column(
            "duration_ms",
            sa.Integer(),
            nullable=True,
        ),
        sa.Column(
            "created_at",
            sa.TIMESTAMP(timezone=True),
            server_default=sa.text("CURRENT_TIMESTAMP"),
            nullable=False,
        ),
        sa.Column(
            "delivered_at",
            sa.TIMESTAMP(timezone=True),
            nullable=True,
        ),
        sa.Column(
            "failed_at",
            sa.TIMESTAMP(timezone=True),
            nullable=True,
        ),
        sa.PrimaryKeyConstraint("id"),
        sa.ForeignKeyConstraint(
            ["subscription_id"],
            ["webhook_subscriptions.id"],
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["event_id"],
            ["webhook_events.id"],
            ondelete="SET NULL",
        ),
    )
    op.create_index(
        "ix_webhook_deliveries_subscription_id",
        "webhook_deliveries",
        ["subscription_id", "created_at"],
    )
    op.create_index(
        "ix_webhook_deliveries_retry",
        "webhook_deliveries",
        ["next_retry_at"],
        postgresql_where=sa.text("status = 'retrying'"),
    )


def downgrade() -> None:
    op.drop_index("ix_webhook_deliveries_retry", table_name="webhook_deliveries")
    op.drop_index(
        "ix_webhook_deliveries_subscription_id", table_name="webhook_deliveries"
    )
    op.drop_table("webhook_deliveries")

    op.drop_index("ix_webhook_events_unprocessed", table_name="webhook_events")
    op.drop_table("webhook_events")

    op.drop_index(
        "ix_webhook_subscriptions_workspace_id", table_name="webhook_subscriptions"
    )
    op.drop_table("webhook_subscriptions")
