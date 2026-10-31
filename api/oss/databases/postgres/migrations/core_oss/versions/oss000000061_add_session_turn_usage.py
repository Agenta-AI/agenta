"""add per-turn usage to session_turns

Revision ID: oss000000061
Revises: oss000000060
Create Date: 2026-10-30 00:00:00.000000

- `session_turns` gets nullable `input_tokens`, `output_tokens`, `total_tokens`,
  `cost` and `usage_source` (`runner` or `trace`). Null means unknown. No backfill:
  older turns show their usage as unavailable.
- `ix_session_turns_project_id_trace_id`: ingest writes a trace's priced usage to the
  turn with the same trace id.

The index is built concurrently in an autocommit block, so writes continue. An
interrupted build leaves an invalid index, so a rerun drops it first.

Old code on the new schema ignores the columns and the index.
"""

from typing import Sequence, Union

from alembic import op

revision: str = "oss000000061"
down_revision: Union[str, None] = "oss000000060"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

_COLUMNS = (
    ("input_tokens", "BIGINT"),
    ("output_tokens", "BIGINT"),
    ("total_tokens", "BIGINT"),
    ("cost", "NUMERIC(18, 9)"),
    ("usage_source", "VARCHAR"),
)

_INDEX = "ix_session_turns_project_id_trace_id"


def upgrade() -> None:
    for name, kind in _COLUMNS:
        op.execute(f"ALTER TABLE session_turns ADD COLUMN IF NOT EXISTS {name} {kind}")
    with op.get_context().autocommit_block():
        op.execute(f"DROP INDEX CONCURRENTLY IF EXISTS {_INDEX}")
        op.execute(
            f"CREATE INDEX CONCURRENTLY {_INDEX} ON session_turns (project_id, trace_id)"
        )


def downgrade() -> None:
    with op.get_context().autocommit_block():
        op.execute(f"DROP INDEX CONCURRENTLY IF EXISTS {_INDEX}")
    for name, _ in _COLUMNS:
        op.execute(f"ALTER TABLE session_turns DROP COLUMN IF EXISTS {name}")
