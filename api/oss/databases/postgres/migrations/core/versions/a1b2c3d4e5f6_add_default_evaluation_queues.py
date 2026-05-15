"""add default evaluation queues

Revision ID: a1b2c3d4e5f6
Revises: e9f0a1b2c3d4
Create Date: 2026-05-15 00:00:00
"""

from typing import Sequence, Union

from alembic import op

revision: str = "a1b2c3d4e5f6"
down_revision: Union[str, None] = "e9f0a1b2c3d4"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute("""
        CREATE UNIQUE INDEX ux_evaluation_queues_default_per_run
        ON evaluation_queues (project_id, run_id)
        WHERE (flags ->> 'is_default')::boolean = true
    """)


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS ux_evaluation_queues_default_per_run")
