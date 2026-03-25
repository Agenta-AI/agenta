"""Add is_split to evaluation run flags

Revision ID: ac23de45fa67
Revises: ab12cd34ef56
Create Date: 2026-03-24 12:15:00
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision: str = "ac23de45fa67"
down_revision: Union[str, None] = "ab12cd34ef56"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    conn = op.get_bind()

    conn.execute(
        sa.text(
            """
            UPDATE evaluation_runs
            SET flags = CASE
                WHEN flags IS NULL THEN '{"is_split": false}'::jsonb
                WHEN NOT (flags ? 'is_split') THEN flags || '{"is_split": false}'::jsonb
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
            SET flags = flags - 'is_split'
            WHERE flags ? 'is_split'
            """
        )
    )
