"""track execution Redis reconciliation

Revision ID: oss000000024
Revises: oss000000023
Create Date: 2026-09-03 22:30:00.000000
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "oss000000024"
down_revision: Union[str, None] = "oss000000023"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "session_executions",
        sa.Column("redis_reconciled_at", sa.TIMESTAMP(timezone=True), nullable=True),
    )
    op.create_index(
        "ix_session_executions_redis_unreconciled",
        "session_executions",
        ["settled_at"],
        postgresql_where=sa.text(
            "settled_by = 'runner' AND terminal_outcome = 'stopped' "
            "AND redis_reconciled_at IS NULL"
        ),
    )


def downgrade() -> None:
    op.drop_index(
        "ix_session_executions_redis_unreconciled",
        table_name="session_executions",
    )
    op.drop_column("session_executions", "redis_reconciled_at")
