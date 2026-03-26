"""Add is_cached to evaluation run flags

Revision ID: ab12cd34ef56
Revises: f0a1b2c3d4e5
Create Date: 2026-03-24 12:00:00
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision: str = "ab12cd34ef56"
down_revision: Union[str, None] = "f0a1b2c3d4e5"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    conn = op.get_bind()

    conn.execute(
        sa.text(
            """
            UPDATE evaluation_runs
            SET flags = CASE
                WHEN flags IS NULL THEN '{"is_cached": false}'::jsonb
                WHEN NOT (flags ? 'is_cached') THEN flags || '{"is_cached": false}'::jsonb
                ELSE flags
            END
            """
        )
    )


def downgrade() -> None:
    conn = op.get_bind()

    conn.execute(
        sa.text(
            """
            UPDATE evaluation_runs
            SET flags = flags - 'is_cached'
            WHERE flags ? 'is_cached'
            """
        )
    )
