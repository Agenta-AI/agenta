"""add session execution ending marker

Revision ID: oss000000025
Revises: oss000000024
Create Date: 2026-09-04 12:00:00.000000
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "oss000000025"
down_revision: Union[str, None] = "oss000000024"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "session_executions",
        sa.Column("ending_written_at", sa.TIMESTAMP(timezone=True), nullable=True),
    )
    op.create_index(
        "ix_session_executions_ending_unwritten",
        "session_executions",
        ["settled_at"],
        postgresql_where=sa.text("ending_written_at IS NULL"),
    )


def downgrade() -> None:
    op.drop_index(
        "ix_session_executions_ending_unwritten",
        table_name="session_executions",
    )
    op.drop_column("session_executions", "ending_written_at")
