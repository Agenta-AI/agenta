"""add interactions table

Revision ID: aa01bb02cc03
Revises: fd77265d65dc
Create Date: 2026-06-28 00:00:00.000000
"""

from typing import Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "aa01bb02cc03"
down_revision: Union[str, None] = "fd77265d65dc"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "interactions",
        sa.Column("project_id", sa.UUID(as_uuid=True), nullable=False),
        sa.Column("id", sa.UUID(as_uuid=True), nullable=False),
        sa.Column("session_id", sa.String(), nullable=False),
        sa.Column("run_id", sa.String(), nullable=True),
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
            name="uq_interactions_project_session_token",
        ),
    )
    op.create_index(
        "ix_interactions_project_id_created_at",
        "interactions",
        ["project_id", "created_at"],
    )
    op.create_index(
        "ix_interactions_project_id_session_id",
        "interactions",
        ["project_id", "session_id"],
    )
    op.create_index(
        "ix_interactions_token",
        "interactions",
        ["project_id", "session_id", "token"],
    )
    op.create_index(
        "ix_interactions_pending",
        "interactions",
        ["project_id"],
        postgresql_where=sa.text(
            "(status->>'code') = 'pending' AND deleted_at IS NULL"
        ),
    )


def downgrade() -> None:
    op.drop_index("ix_interactions_pending", table_name="interactions")
    op.drop_index("ix_interactions_token", table_name="interactions")
    op.drop_index("ix_interactions_project_id_session_id", table_name="interactions")
    op.drop_index("ix_interactions_project_id_created_at", table_name="interactions")
    op.drop_table("interactions")
