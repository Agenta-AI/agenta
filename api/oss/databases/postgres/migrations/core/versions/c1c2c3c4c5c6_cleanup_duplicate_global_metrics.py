"""cleanup duplicate global metrics

Revision ID: c1c2c3c4c5c6
Revises: a1b2c3d4e5f6
Create Date: 2025-12-04 12:00:00.000000

This migration removes duplicate global metrics (rows where scenario_id IS NULL
and timestamp IS NULL for the same project_id, run_id pair) before applying the
unique index constraint. For each duplicate set, we keep the most recently
updated row and delete older duplicates.
"""

from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision: str = "c1c2c3c4c5c6"
down_revision: Union[str, None] = "a1b2c3d4e5f6"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Remove duplicate metrics across all three scenarios."""
    conn = op.get_bind()

    # Scenario 1: Global Metrics (project_id, run_id)
    # where scenario_id IS NULL AND timestamp IS NULL
    # Delete ALL duplicates (rows that share same project_id, run_id)
    conn.execute(
        sa.text(
            """
            DELETE FROM evaluation_metrics
            WHERE (project_id, run_id) IN (
                SELECT project_id, run_id
                FROM evaluation_metrics
                WHERE scenario_id IS NULL
                  AND timestamp IS NULL
                GROUP BY project_id, run_id
                HAVING COUNT(*) > 1
            )
              AND scenario_id IS NULL
              AND timestamp IS NULL
            """
        )
    )

    # Scenario 2: Variational Metrics (project_id, run_id, scenario_id)
    # where timestamp IS NULL
    # Delete ALL duplicates (rows that share same project_id, run_id, scenario_id)
    conn.execute(
        sa.text(
            """
            DELETE FROM evaluation_metrics
            WHERE (project_id, run_id, scenario_id) IN (
                SELECT project_id, run_id, scenario_id
                FROM evaluation_metrics
                WHERE timestamp IS NULL
                  AND scenario_id IS NOT NULL
                GROUP BY project_id, run_id, scenario_id
                HAVING COUNT(*) > 1
            )
              AND timestamp IS NULL
              AND scenario_id IS NOT NULL
            """
        )
    )

    # Scenario 3: Temporal Metrics (project_id, run_id, timestamp)
    # where scenario_id IS NULL
    # Delete ALL duplicates (rows that share same project_id, run_id, timestamp)
    conn.execute(
        sa.text(
            """
            DELETE FROM evaluation_metrics
            WHERE (project_id, run_id, timestamp) IN (
                SELECT project_id, run_id, timestamp
                FROM evaluation_metrics
                WHERE scenario_id IS NULL
                  AND timestamp IS NOT NULL
                GROUP BY project_id, run_id, timestamp
                HAVING COUNT(*) > 1
            )
              AND scenario_id IS NULL
              AND timestamp IS NOT NULL
            """
        )
    )


def downgrade() -> None:
    # Data-destructive; nothing to restore
    pass
