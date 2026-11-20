"""add the one-time fire time to trigger schedules

Revision ID: oss000000064
Revises: oss000000063
Create Date: 2026-11-20 00:00:00.000000

A schedule fires on a cron expression or, new, once at `run_at`. Only server code
creates one-time schedules; the public routes refuse `run_at`.

| Object | Change |
| --- | --- |
| trigger_schedules.run_at | NEW nullable column (timestamptz). NULL for every existing row, so no row changes. |
| trigger_schedules | NEW partial index ix_trigger_schedules_run_at (run_at) WHERE run_at IS NOT NULL AND deleted_at IS NULL, built concurrently. |

Deploy this revision before the code that reads the column. An older API pod does not
read the column.

Rerun. Entering the autocommit block commits the column, so a rerun after a failure in
the block finds it. Every statement is `IF NOT EXISTS` or `IF EXISTS`, so the rerun is
safe.
"""

from typing import Sequence, Union

from alembic import op
from sqlalchemy import text

revision: str = "oss000000064"
down_revision: Union[str, None] = "oss000000063"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


_INDEX = "ix_trigger_schedules_run_at"

_ADD_COLUMN_SQL = (
    "ALTER TABLE trigger_schedules ADD COLUMN IF NOT EXISTS run_at TIMESTAMPTZ NULL"
)

_CREATE_INDEX_SQL = (
    f"CREATE INDEX CONCURRENTLY IF NOT EXISTS {_INDEX} "
    "ON trigger_schedules (run_at) "
    "WHERE run_at IS NOT NULL AND deleted_at IS NULL"
)


def upgrade() -> None:
    # A nullable column with no default changes only the catalog.
    op.execute(_ADD_COLUMN_SQL)

    # Entering the block commits the column; a concurrent build lets writes run.
    with op.get_context().autocommit_block():
        op.execute(_CREATE_INDEX_SQL)

        # IF NOT EXISTS skips an invalid index left by an interrupted build, so stop
        # here instead of recording the revision without the index.
        is_valid = (
            op.get_bind()
            .execute(
                text(
                    "SELECT indisvalid FROM pg_catalog.pg_index "
                    "WHERE indexrelid = pg_catalog.to_regclass(:name)"
                ),
                {"name": _INDEX},
            )
            .scalar()
        )
        if is_valid is not True:
            raise RuntimeError(
                f"Index {_INDEX} is missing or invalid. Run "
                f"DROP INDEX CONCURRENTLY {_INDEX} outside a transaction, then rerun "
                "the migration."
            )


def downgrade() -> None:
    with op.get_context().autocommit_block():
        op.execute(f"DROP INDEX CONCURRENTLY IF EXISTS {_INDEX}")
    op.execute("ALTER TABLE trigger_schedules DROP COLUMN IF EXISTS run_at")
