"""add per-turn usage to session_turns, and the read indexes of trace privacy

Revision ID: oss000000055
Revises: oss000000054
Create Date: 2026-10-28 00:00:00.000000

Trace privacy (M9):

- `session_turns` gets nullable `input_tokens`, `output_tokens`, `total_tokens`,
  `cost` and `usage_source` (`runner` or `trace`). Null means unknown. No backfill:
  older turns show their usage as unavailable.
- `ix_session_turns_project_id_trace_id`: ingest writes a trace's priced usage to the
  turn with the same trace id.
- `ix_session_streams_project_id_private_owner`: the trace read scope lists a project's
  private sessions; the partial index reads only those rows.

The indexes are built concurrently in an autocommit block, so writes continue. An
interrupted build leaves an invalid index, so a rerun drops it first.

Old code on the new schema ignores the columns and the indexes.
"""

from typing import Sequence, Union

from alembic import op

revision: str = "oss000000055"
down_revision: Union[str, None] = "oss000000054"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

_COLUMNS = (
    ("input_tokens", "BIGINT"),
    ("output_tokens", "BIGINT"),
    ("total_tokens", "BIGINT"),
    ("cost", "NUMERIC(18, 9)"),
    ("usage_source", "VARCHAR"),
)

_INDEXES = (
    (
        "ix_session_turns_project_id_trace_id",
        "ON session_turns (project_id, trace_id)",
    ),
    (
        "ix_session_streams_project_id_private_owner",
        "ON session_streams (project_id, owner_user_id) WHERE visibility = 'private'",
    ),
)


def upgrade() -> None:
    for name, kind in _COLUMNS:
        op.execute(f"ALTER TABLE session_turns ADD COLUMN IF NOT EXISTS {name} {kind}")
    with op.get_context().autocommit_block():
        for name, definition in _INDEXES:
            op.execute(f"DROP INDEX CONCURRENTLY IF EXISTS {name}")
            op.execute(f"CREATE INDEX CONCURRENTLY {name} {definition}")


def downgrade() -> None:
    with op.get_context().autocommit_block():
        for name, _ in _INDEXES:
            op.execute(f"DROP INDEX CONCURRENTLY IF EXISTS {name}")
    for name, _ in _COLUMNS:
        op.execute(f"ALTER TABLE session_turns DROP COLUMN IF EXISTS {name}")
