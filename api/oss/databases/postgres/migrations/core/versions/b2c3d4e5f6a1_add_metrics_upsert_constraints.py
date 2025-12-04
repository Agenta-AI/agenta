"""add metrics upsert constraints (partial unique indexes)

Revision ID: b2c3d4e5f6a1
Revises: a1b2c3d4e5f6
Create Date: 2025-12-04 12:00:00.000000

This migration replaces the broken unique constraint (which allows multiple
NULLs) with three partial unique indexes that enforce uniqueness for valid
NULL combinations.
"""

from typing import Sequence, Union
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "b2c3d4e5f6a1"
down_revision: Union[str, None] = "c1c2c3c4c5c6"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Remove broken unique constraint and add partial unique constraints."""

    # Step 1: Drop broken unique constraint
    # This constraint allowed multiple rows with (run_id, NULL, NULL)
    # because PostgreSQL treats NULL != NULL in unique constraints
    op.drop_constraint(
        "uq_evaluation_metrics_project_run_scenario_timestamp_interval",
        "evaluation_metrics",
        type_="unique",
    )

    # Step 2: Create partial unique constraint for Global Metrics
    # Global metric: (project_id, run_id) where scenario_id IS NULL AND timestamp IS NULL
    # Ensures: Only ONE global metric per (project_id, run_id)
    op.execute("""
        ALTER TABLE evaluation_metrics
        ADD CONSTRAINT ux_evaluation_metrics_global
        UNIQUE (project_id, run_id)
        WHERE scenario_id IS NULL AND timestamp IS NULL
    """)

    # Step 3: Create partial unique constraint for Variational Metrics
    # Variational metric: (project_id, run_id, scenario_id) where timestamp IS NULL
    # Ensures: Only ONE variational metric per (project_id, run_id, scenario_id)
    op.execute("""
        ALTER TABLE evaluation_metrics
        ADD CONSTRAINT ux_evaluation_metrics_variational
        UNIQUE (project_id, run_id, scenario_id)
        WHERE timestamp IS NULL AND scenario_id IS NOT NULL
    """)

    # Step 4: Create partial unique constraint for Temporal Metrics
    # Temporal metric: (project_id, run_id, timestamp) where scenario_id IS NULL
    # Ensures: Only ONE temporal metric per (project_id, run_id, timestamp)
    op.execute("""
        ALTER TABLE evaluation_metrics
        ADD CONSTRAINT ux_evaluation_metrics_temporal
        UNIQUE (project_id, run_id, timestamp)
        WHERE scenario_id IS NULL AND timestamp IS NOT NULL
    """)


def downgrade() -> None:
    """Rollback to old unique constraint."""

    # Remove the three partial unique constraints
    op.drop_constraint("ux_evaluation_metrics_global", "evaluation_metrics", type_="unique")
    op.drop_constraint("ux_evaluation_metrics_variational", "evaluation_metrics", type_="unique")
    op.drop_constraint("ux_evaluation_metrics_temporal", "evaluation_metrics", type_="unique")

    # Recreate the old broken unique constraint
    op.create_unique_constraint(
        "evaluation_metrics_project_id_run_id_scenario_id_timestamp_key",
        "evaluation_metrics",
        ["project_id", "run_id", "scenario_id", "timestamp"],
    )
