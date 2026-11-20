"""add spans.turn_id

Revision ID: oss000000008
Revises: oss000000007
Create Date: 2026-11-16 00:00:00.000000

- `spans` gets nullable `turn_id`. Ingest fills it from each span's own
  `ag.turn.id`. No backfill: older spans keep a null `turn_id`.
- `ix_spans_project_id_turn_id`: partial on `turn_id IS NOT NULL`, for span
  queries by turn. It holds only new rows, so it starts empty.

`SET LOCAL lock_timeout` makes the short catalog lock of `ADD COLUMN` fail fast
instead of queueing ingest writes behind it. It is scoped to this migration's
transaction, so it does not apply to the index build or to later migrations.

The index is built concurrently in an autocommit block, so writes continue. An
interrupted build leaves an invalid index and a committed column, so a rerun
adds the column only if it is missing and drops the index first.

Old code on the new schema ignores the column and the index.
"""

from typing import Sequence, Union

from alembic import op

revision: str = "oss000000008"
down_revision: Union[str, None] = "oss000000007"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

_INDEX = "ix_spans_project_id_turn_id"


def upgrade() -> None:
    op.execute("SET LOCAL lock_timeout = '10s'")
    op.execute("ALTER TABLE spans ADD COLUMN IF NOT EXISTS turn_id VARCHAR")
    with op.get_context().autocommit_block():
        op.execute(f"DROP INDEX CONCURRENTLY IF EXISTS {_INDEX}")
        op.execute(
            f"CREATE INDEX CONCURRENTLY {_INDEX} "
            "ON spans (project_id, turn_id) WHERE turn_id IS NOT NULL"
        )


def downgrade() -> None:
    with op.get_context().autocommit_block():
        op.execute(f"DROP INDEX CONCURRENTLY IF EXISTS {_INDEX}")
    op.execute("ALTER TABLE spans DROP COLUMN IF EXISTS turn_id")
