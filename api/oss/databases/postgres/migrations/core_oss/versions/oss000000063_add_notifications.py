"""add notifications

`notifications` holds one row for each thing a person is told about, with at most one
open row for each `(project_id, dedup_key)`. `notification_deliveries` holds one row for
each recipient and channel. Neither table stores an email address.

Both tables are new and empty, so their indexes are built in the same transaction. The
foreign keys to `projects` take a short lock on it, under a lock timeout.

Revision ID: oss000000063
Revises: oss000000062
Create Date: 2026-11-05 00:00:00.000000
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "oss000000063"
down_revision: Union[str, None] = "oss000000062"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _lifecycle_columns() -> list[sa.Column]:
    return [
        sa.Column(
            "created_at",
            sa.TIMESTAMP(timezone=True),
            server_default=sa.text("CURRENT_TIMESTAMP"),
            nullable=True,
        ),
        sa.Column("updated_at", sa.TIMESTAMP(timezone=True), nullable=True),
        sa.Column("deleted_at", sa.TIMESTAMP(timezone=True), nullable=True),
        sa.Column("created_by_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("updated_by_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("deleted_by_id", postgresql.UUID(as_uuid=True), nullable=True),
    ]


def upgrade() -> None:
    op.execute("SET LOCAL lock_timeout = '5s'")
    op.create_table(
        "notifications",
        sa.Column("project_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("kind", sa.String(), nullable=False),
        sa.Column("dedup_key", sa.String(), nullable=False),
        sa.Column("state", sa.String(), nullable=False),
        sa.Column("data", postgresql.JSONB(), nullable=False),
        *_lifecycle_columns(),
        sa.PrimaryKeyConstraint("project_id", "id", name="pk_notifications"),
        sa.ForeignKeyConstraint(
            ["project_id"],
            ["projects.id"],
            ondelete="CASCADE",
            name="fk_notifications_project_id",
        ),
    )
    op.create_index(
        "uq_notifications_project_id_dedup_key_open",
        "notifications",
        ["project_id", "dedup_key"],
        unique=True,
        postgresql_where=sa.text("state = 'open'"),
    )

    op.create_table(
        "notification_deliveries",
        sa.Column("project_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("notification_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("user_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("channel", sa.String(), nullable=False),
        sa.Column("state", sa.String(), nullable=False),
        sa.Column(
            "attempt_count",
            sa.Integer(),
            server_default=sa.text("0"),
            nullable=False,
        ),
        sa.Column("sent_at", sa.TIMESTAMP(timezone=True), nullable=True),
        *_lifecycle_columns(),
        sa.PrimaryKeyConstraint("project_id", "id", name="pk_notification_deliveries"),
        sa.ForeignKeyConstraint(
            ["project_id"],
            ["projects.id"],
            ondelete="CASCADE",
            name="fk_notification_deliveries_project_id",
        ),
    )
    op.create_index(
        "uq_notification_deliveries_notification_id_user_id_channel",
        "notification_deliveries",
        ["project_id", "notification_id", "user_id", "channel"],
        unique=True,
    )
    op.create_index(
        "ix_notification_deliveries_created_project_id_created_at",
        "notification_deliveries",
        ["project_id", "created_at"],
        postgresql_where=sa.text("state = 'created'"),
    )


def downgrade() -> None:
    op.drop_table("notification_deliveries")
    op.drop_table("notifications")
