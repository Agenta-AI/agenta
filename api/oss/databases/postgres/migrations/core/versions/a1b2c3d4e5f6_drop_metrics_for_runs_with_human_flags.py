"""Drop metrics rows for runs with has_human flag

Revision ID: a1b2c3d4e5f6
Revises: 652f6113b5f5
Create Date: 2025-11-28 00:00:00

"""

from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision: str = "a1b2c3d4e5f6"
down_revision: Union[str, None] = "652f6113b5f5"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    conn = op.get_bind()

    # Find all runs with has_human set to True in their flags
    runs_with_human = conn.execute(
        sa.text("""
            SELECT project_id, id FROM evaluation_runs
            WHERE flags::jsonb ->> 'has_human' = 'true'
        """)
    ).fetchall()

    # Delete metrics for those runs
    for project_id, run_id in runs_with_human:
        conn.execute(
            sa.text("""
                DELETE FROM evaluation_metrics
                WHERE project_id = :project_id AND run_id = :run_id
            """),
            {"project_id": project_id, "run_id": run_id},
        )


def downgrade() -> None:
    pass
