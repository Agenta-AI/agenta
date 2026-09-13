"""add durable interaction continuation executions

Revision ID: oss000000027
Revises: oss000000026
Create Date: 2026-09-04 12:00:00.000000
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision: str = "oss000000027"
down_revision: Union[str, None] = "oss000000026"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.drop_constraint("ck_session_commands_kind", "session_commands", type_="check")
    op.create_check_constraint(
        "ck_session_commands_kind",
        "session_commands",
        "kind IN ('cancel', 'continue_interaction')",
    )

    op.alter_column("session_executions", "terminal_outcome", nullable=True)
    op.alter_column("session_executions", "settled_by", nullable=True)
    op.alter_column("session_executions", "settled_at", nullable=True)
    op.add_column(
        "session_executions",
        sa.Column("state", sa.String(), server_default="terminal", nullable=False),
    )
    op.add_column(
        "session_executions",
        sa.Column("parent_execution_id", sa.String(), nullable=True),
    )
    op.add_column(
        "session_executions",
        sa.Column("source_interaction_id", sa.UUID(as_uuid=True), nullable=True),
    )
    op.add_column(
        "session_executions",
        sa.Column("error", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
    )
    op.alter_column(
        "session_executions", "state", server_default="active", nullable=False
    )
    op.create_index(
        "uq_session_executions_source_interaction",
        "session_executions",
        ["project_id", "source_interaction_id"],
        unique=True,
        postgresql_where=sa.text("source_interaction_id IS NOT NULL"),
    )


def downgrade() -> None:
    op.drop_index(
        "uq_session_executions_source_interaction", table_name="session_executions"
    )
    op.drop_column("session_executions", "error")
    op.drop_column("session_executions", "source_interaction_id")
    op.drop_column("session_executions", "parent_execution_id")
    op.drop_column("session_executions", "state")
    op.execute("DELETE FROM session_executions WHERE terminal_outcome IS NULL")
    op.alter_column("session_executions", "settled_at", nullable=False)
    op.alter_column("session_executions", "settled_by", nullable=False)
    op.alter_column("session_executions", "terminal_outcome", nullable=False)

    op.drop_constraint("ck_session_commands_kind", "session_commands", type_="check")
    op.create_check_constraint(
        "ck_session_commands_kind", "session_commands", "kind IN ('cancel')"
    )
