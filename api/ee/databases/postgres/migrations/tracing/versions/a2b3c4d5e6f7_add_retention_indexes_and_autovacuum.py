"""Add retention helper indexes on spans + autovacuum tuning

Revision ID: a2b3c4d5e6f7
Revises: cfa14a847972
Create Date: 2025-01-06 12:00:00.000000

"""

from typing import Sequence, Union

from alembic import op
from sqlalchemy import text

# revision identifiers, used by Alembic.
revision: str = "a2b3c4d5e6f7"
down_revision: Union[str, None] = "cfa14a847972"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    conn = op.get_bind()
    conn = conn.execution_options(isolation_level="AUTOCOMMIT")

    # Unique partial index: enforce single root span per trace
    conn.execute(
        text("""
        CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS ux_spans_root_per_trace
        ON public.spans (project_id, trace_id)
        WHERE parent_id IS NULL;
    """)
    )

    # Retention selection index (critical for performance)
    conn.execute(
        text("""
        CREATE INDEX CONCURRENTLY IF NOT EXISTS ix_spans_root_project_created_trace
        ON public.spans (project_id, created_at, trace_id)
        WHERE parent_id IS NULL;
    """)
    )

    # Autovacuum tuning for high-churn retention workload
    conn.execute(
        text("""
        ALTER TABLE public.spans SET (
          autovacuum_vacuum_scale_factor = 0.02,
          autovacuum_analyze_scale_factor = 0.01,
          autovacuum_vacuum_cost_delay = 5,
          autovacuum_vacuum_cost_limit = 4000
        );
    """)
    )


def downgrade() -> None:
    conn = op.get_bind()
    conn = conn.execution_options(isolation_level="AUTOCOMMIT")

    conn.execute(
        text("DROP INDEX CONCURRENTLY IF EXISTS public.ux_spans_root_per_trace;")
    )
    conn.execute(
        text(
            "DROP INDEX CONCURRENTLY IF EXISTS public.ix_spans_root_project_created_trace;"
        )
    )
    conn.execute(
        text("""
        ALTER TABLE public.spans RESET (
            autovacuum_vacuum_scale_factor,
            autovacuum_analyze_scale_factor,
            autovacuum_vacuum_cost_delay,
            autovacuum_vacuum_cost_limit
        );
    """)
    )
