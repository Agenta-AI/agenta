"""add default evaluation queues

Revision ID: a1d2e3f4a5b6
Revises: f7a8b9c0d1e2
Create Date: 2026-05-15 00:00:00

Previously shared revision id `a1b2c3d4e5f6` with
`drop_corrupted_metrics_for_some_runs`, so alembic skipped it and the index
below never ran. Renamed to `a1d2e3f4a5b6` and chained after main's head
`e6f7a8b9c0d1` to keep the branch a single linear chain.

The partial unique index covers ALL default queues (active or archived), so
there is at most ONE default queue row per (project_id, run_id) for the lifetime
of the run. Archiving a default does NOT free the slot — the single row is
archived/unarchived in place by reconcile, and user-facing archive of a default
is forbidden in the service layer.
"""

from typing import Sequence, Union

from alembic import op

revision: str = "a1d2e3f4a5b6"
down_revision: Union[str, None] = "f7a8b9c0d1e2"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute("DROP INDEX IF EXISTS ux_evaluation_queues_default_per_run")
    op.execute("""
        CREATE UNIQUE INDEX ux_evaluation_queues_default_per_run
        ON evaluation_queues (project_id, run_id)
        WHERE (flags ->> 'is_default')::boolean = true
    """)


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS ux_evaluation_queues_default_per_run")
