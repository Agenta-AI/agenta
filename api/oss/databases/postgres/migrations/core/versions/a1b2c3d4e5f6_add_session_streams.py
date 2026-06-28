"""add session_streams table

Revision ID: a1b2c3d4e5f6
Revises: fd77265d65dc
Create Date: 2026-06-28 00:00:00.000000

"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision: str = "a1b2c3d4e5f6"
down_revision: Union[str, None] = "fd77265d65dc"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "session_streams",
        sa.Column("id", sa.UUID(as_uuid=True), nullable=False),
        sa.Column("project_id", sa.UUID(as_uuid=True), nullable=False),
        sa.Column("session_id", sa.String(), nullable=False),
        sa.Column("attached", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column(
            "sandbox_live", sa.Boolean(), nullable=False, server_default=sa.false()
        ),
        sa.Column(
            "last_seen_at",
            sa.TIMESTAMP(timezone=True),
            server_default=sa.func.current_timestamp(),
            nullable=True,
        ),
        sa.Column(
            "status",
            postgresql.JSONB(none_as_null=True),
            nullable=True,
        ),
        sa.Column(
            "created_at",
            sa.TIMESTAMP(timezone=True),
            server_default=sa.func.current_timestamp(),
            nullable=True,
        ),
        sa.Column("updated_at", sa.TIMESTAMP(timezone=True), nullable=True),
        sa.Column("deleted_at", sa.TIMESTAMP(timezone=True), nullable=True),
        sa.Column("created_by_id", sa.UUID(as_uuid=True), nullable=True),
        sa.Column("updated_by_id", sa.UUID(as_uuid=True), nullable=True),
        sa.Column("deleted_by_id", sa.UUID(as_uuid=True), nullable=True),
        sa.ForeignKeyConstraint(
            ["project_id"],
            ["projects.id"],
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("project_id", "id"),
        sa.UniqueConstraint("session_id", name="uq_session_streams_session_id"),
    )
    op.create_index(
        "ix_session_streams_project_id_created_at",
        "session_streams",
        ["project_id", "created_at"],
    )
    op.create_index(
        "ix_session_streams_session_id",
        "session_streams",
        ["session_id"],
    )
    op.create_index(
        "ix_session_streams_sandbox_live_last_seen_at",
        "session_streams",
        ["sandbox_live", "last_seen_at"],
    )


def downgrade() -> None:
    op.drop_index(
        "ix_session_streams_sandbox_live_last_seen_at",
        table_name="session_streams",
    )
    op.drop_index(
        "ix_session_streams_session_id",
        table_name="session_streams",
    )
    op.drop_index(
        "ix_session_streams_project_id_created_at",
        table_name="session_streams",
    )
    op.drop_table("session_streams")
