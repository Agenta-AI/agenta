"""add authoritative session execution terminal outcomes

Revision ID: oss000000023
Revises: oss000000022
Create Date: 2026-09-03 22:00:00.000000
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "oss000000023"
down_revision: Union[str, None] = "oss000000022"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "session_executions",
        sa.Column("project_id", sa.UUID(as_uuid=True), nullable=False),
        sa.Column("session_id", sa.String(), nullable=False),
        sa.Column("execution_id", sa.String(), nullable=False),
        sa.Column("terminal_outcome", sa.String(), nullable=False),
        sa.Column("settled_by", sa.String(), nullable=False),
        sa.Column("settled_at", sa.TIMESTAMP(timezone=True), nullable=False),
        sa.Column("records_closed_at", sa.TIMESTAMP(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(["project_id"], ["projects.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("project_id", "session_id", "execution_id"),
    )
    op.create_index(
        "ix_session_executions_project_session",
        "session_executions",
        ["project_id", "session_id"],
    )


def downgrade() -> None:
    op.drop_index(
        "ix_session_executions_project_session", table_name="session_executions"
    )
    op.drop_table("session_executions")
