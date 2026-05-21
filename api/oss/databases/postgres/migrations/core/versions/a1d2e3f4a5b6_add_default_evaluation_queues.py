"""add default evaluation queues

Revision ID: a1d2e3f4a5b6
Revises: e6f7a8b9c0d1
Create Date: 2026-05-15 00:00:00

NOTE: this migration previously shared the revision id `a1b2c3d4e5f6` with
`drop_corrupted_metrics_for_some_runs`, so alembic could not resolve it and the
index below never ran (see UEL-030). Renamed to `a1d2e3f4a5b6`. It is chained
after the current head of `main` (`e6f7a8b9c0d1`) so the branch's new migrations
form a single linear chain on top of main, instead of forking off an older node.
The partial unique index is scoped to ACTIVE default queues (`deleted_at IS
NULL`) so a default queue can be archived and later recreated/unarchived by
reconcile.
"""

from typing import Sequence, Union

from alembic import op

revision: str = "a1d2e3f4a5b6"
down_revision: Union[str, None] = "e6f7a8b9c0d1"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute("DROP INDEX IF EXISTS ux_evaluation_queues_default_per_run")
    op.execute("""
        CREATE UNIQUE INDEX ux_evaluation_queues_default_per_run
        ON evaluation_queues (project_id, run_id)
        WHERE (flags ->> 'is_default')::boolean = true AND deleted_at IS NULL
    """)


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS ux_evaluation_queues_default_per_run")
