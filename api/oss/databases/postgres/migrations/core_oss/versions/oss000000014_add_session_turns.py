"""add session_turns table

Revision ID: oss000000014
Revises: oss000000013
Create Date: 2026-07-17 00:00:00.000000

"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision: str = "oss000000014"
down_revision: Union[str, None] = "oss000000013"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "session_turns",
        sa.Column("id", sa.UUID(as_uuid=True), nullable=False),
        sa.Column("project_id", sa.UUID(as_uuid=True), nullable=False),
        sa.Column("session_id", sa.String(), nullable=False),
        sa.Column("stream_id", sa.UUID(as_uuid=True), nullable=False),
        sa.Column("turn_index", sa.Integer(), nullable=False),
        sa.Column("harness", sa.String(), nullable=False),
        sa.Column("agent_session_id", sa.String(), nullable=True),
        sa.Column("sandbox_id", sa.String(), nullable=True),
        sa.Column(
            "references",
            postgresql.JSONB(none_as_null=True),
            nullable=True,
        ),
        sa.Column("trace_id", sa.UUID(as_uuid=True), nullable=True),
        sa.Column("span_id", sa.UUID(as_uuid=True), nullable=True),
        sa.Column("start_time", sa.TIMESTAMP(timezone=True), nullable=True),
        sa.Column("end_time", sa.TIMESTAMP(timezone=True), nullable=True),
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
        sa.ForeignKeyConstraint(
            ["project_id", "stream_id"],
            ["session_streams.project_id", "session_streams.id"],
            ondelete="NO ACTION",
        ),
        sa.PrimaryKeyConstraint("project_id", "id"),
    )
    op.create_index(
        "ix_session_turns_project_id_session_id",
        "session_turns",
        ["project_id", "session_id"],
    )
    op.create_index(
        "ix_session_turns_project_id_session_id_turn_index",
        "session_turns",
        ["project_id", "session_id", "turn_index"],
    )
    op.create_index(
        "ix_session_turns_references",
        "session_turns",
        ["references"],
        postgresql_using="gin",
        postgresql_ops={"references": "jsonb_path_ops"},
    )


def downgrade() -> None:
    op.drop_index(
        "ix_session_turns_references",
        table_name="session_turns",
    )
    op.drop_index(
        "ix_session_turns_project_id_session_id_turn_index",
        table_name="session_turns",
    )
    op.drop_index(
        "ix_session_turns_project_id_session_id",
        table_name="session_turns",
    )
    op.drop_table("session_turns")
