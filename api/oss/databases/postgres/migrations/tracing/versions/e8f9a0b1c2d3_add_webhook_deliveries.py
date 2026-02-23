"""add webhook deliveries table

Revision ID: e8f9a0b1c2d3
Revises: d1e2f3a4b5c6
Create Date: 2026-02-23 20:11:00.000000

"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision: str = "e8f9a0b1c2d3"
down_revision: Union[str, None] = "d1e2f3a4b5c6"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "webhook_deliveries",
        sa.Column("id", sa.UUID(), nullable=False),
        sa.Column("subscription_id", sa.UUID(), nullable=False),
        sa.Column("event_id", sa.UUID(), nullable=False),
        sa.Column("status", sa.String(length=20), nullable=False),
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
        sa.Column("created_by_id", sa.UUID(), nullable=False),
        sa.Column("updated_by_id", sa.UUID(), nullable=True),
        sa.Column("deleted_by_id", sa.UUID(), nullable=True),
        sa.PrimaryKeyConstraint("id"),
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
        ["subscription_id", "event_id"],
        unique=False,
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
    op.drop_table("webhook_deliveries")
