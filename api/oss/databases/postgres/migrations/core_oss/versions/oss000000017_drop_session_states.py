"""drop session_states table

Superseded by the session_streams header (name/description) — the /sessions/states/
router now reads/writes the merged stream row via streams_service. The standalone
table, its DAO/service, and DBE are orphaned; drop the physical table.

Revision ID: oss000000017
Revises: oss000000016
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision: str = "oss000000017"
down_revision: Union[str, None] = "oss000000016"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.drop_table("session_states")


def downgrade() -> None:
    op.create_table(
        "session_states",
        sa.Column("project_id", sa.UUID(), nullable=False),
        sa.Column("id", sa.UUID(), nullable=False),
        sa.Column("session_id", sa.String(), nullable=False),
        sa.Column("sandbox_id", sa.String(), nullable=True),
        sa.Column(
            "data",
            postgresql.JSON(astext_type=sa.Text()),
            nullable=True,
        ),
        sa.Column("flags", postgresql.JSONB(none_as_null=True), nullable=True),
        sa.Column("tags", postgresql.JSONB(none_as_null=True), nullable=True),
        sa.Column("meta", postgresql.JSON(none_as_null=True), nullable=True),
        sa.Column(
            "created_at",
            sa.TIMESTAMP(timezone=True),
            server_default=sa.text("CURRENT_TIMESTAMP"),
            nullable=True,
        ),
        sa.Column("updated_at", sa.TIMESTAMP(timezone=True), nullable=True),
        sa.Column("deleted_at", sa.TIMESTAMP(timezone=True), nullable=True),
        sa.Column("created_by_id", sa.UUID(), nullable=True),
        sa.Column("updated_by_id", sa.UUID(), nullable=True),
        sa.Column("deleted_by_id", sa.UUID(), nullable=True),
        sa.ForeignKeyConstraint(["project_id"], ["projects.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("project_id", "id"),
        sa.UniqueConstraint(
            "project_id",
            "session_id",
            name="uq_session_states_project_session_id",
        ),
    )
