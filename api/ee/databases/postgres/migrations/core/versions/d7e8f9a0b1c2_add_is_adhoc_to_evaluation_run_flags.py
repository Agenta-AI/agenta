"""Add is_adhoc to evaluation run flags

Revision ID: d7e8f9a0b1c2
Revises: c2d3e4f5a6b7
Create Date: 2026-02-26 12:00:00
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision: str = "d7e8f9a0b1c2"
down_revision: Union[str, None] = "c2d3e4f5a6b7"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    conn = op.get_bind()

    conn.execute(
        sa.text(
            """
            UPDATE evaluation_runs
            SET flags = CASE
                WHEN flags IS NULL THEN '{"is_adhoc": false}'::jsonb
                WHEN NOT (flags ? 'is_adhoc') THEN flags || '{"is_adhoc": false}'::jsonb
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
            SET flags = flags - 'is_adhoc'
            WHERE flags ? 'is_adhoc'
            """
        )
    )
