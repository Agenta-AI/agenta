"""add session_interactions table

Revision ID: oss000000009
Revises: oss000000008
Create Date: 2026-06-28 00:00:00.000000
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "oss000000009"
down_revision: Union[str, None] = "oss000000008"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "session_interactions",
        sa.Column("project_id", sa.UUID(as_uuid=True), nullable=False),
        sa.Column("id", sa.UUID(as_uuid=True), nullable=False),
        sa.Column("session_id", sa.String(), nullable=False),
        sa.Column("turn_id", sa.String(), nullable=True),
        sa.Column("token", sa.String(), nullable=False),
        sa.Column("kind", sa.String(), nullable=False),
        sa.Column("status", postgresql.JSONB(none_as_null=True), nullable=True),
        sa.Column("data", postgresql.JSON(none_as_null=True), nullable=True),
        sa.Column("flags", postgresql.JSONB(none_as_null=True), nullable=True),
        sa.Column(
            "created_at",
            sa.TIMESTAMP(timezone=True),
            server_default=sa.text("CURRENT_TIMESTAMP"),
            nullable=True,
        ),
        sa.Column("updated_at", sa.TIMESTAMP(timezone=True), nullable=True),
        sa.Column("deleted_at", sa.TIMESTAMP(timezone=True), nullable=True),
        sa.Column("created_by_id", sa.UUID(as_uuid=True), nullable=True),
        sa.Column("updated_by_id", sa.UUID(as_uuid=True), nullable=True),
        sa.Column("deleted_by_id", sa.UUID(as_uuid=True), nullable=True),
        sa.ForeignKeyConstraint(["project_id"], ["projects.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("project_id", "id"),
        sa.UniqueConstraint(
            "project_id",
            "session_id",
            "token",
            name="uq_session_interactions_project_session_token",
        ),
    )
    op.create_index(
        "ix_session_interactions_project_id_created_at",
        "session_interactions",
        ["project_id", "created_at"],
    )
    op.create_index(
        "ix_session_interactions_project_id_session_id",
        "session_interactions",
        ["project_id", "session_id"],
    )
    op.create_index(
        "ix_session_interactions_token",
        "session_interactions",
        ["project_id", "session_id", "token"],
    )
    op.create_index(
        "ix_session_interactions_pending",
        "session_interactions",
        ["project_id"],
        postgresql_where=sa.text(
            "(status->>'code') = 'pending' AND deleted_at IS NULL"
        ),
    )


def downgrade() -> None:
    op.drop_index("ix_session_interactions_pending", table_name="session_interactions")
    op.drop_index("ix_session_interactions_token", table_name="session_interactions")
    op.drop_index(
        "ix_session_interactions_project_id_session_id",
        table_name="session_interactions",
    )
    op.drop_index(
        "ix_session_interactions_project_id_created_at",
        table_name="session_interactions",
    )
    op.drop_table("session_interactions")
