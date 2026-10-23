"""add the run principal columns

Revision ID: oss000000046
Revises: oss000000045
Create Date: 2026-10-23 00:00:00.000000

Every run gets a principal (human, api_key or installation), a run context, and on a
turn its sender and approver. This revision is the short schema expansion; the backfill
of existing schedules, subscriptions and evaluation runs is `oss000000047`, a separate
revision of the same release.

Every column is nullable, with no default, no foreign key and no check constraint, so
each `ADD COLUMN` is a catalog change only. `lock_timeout` bounds the wait for the
`ACCESS EXCLUSIVE` lock: a long-running transaction on one of these tables fails the hook
after 5 s instead of queueing every other query behind the `ALTER TABLE`, and the deploy
is re-run. The two indexes are built CONCURRENTLY in an autocommit block, which commits
the column changes first, so their locks are held for milliseconds, never during a build
or a backfill.

| Table | Columns |
| --- | --- |
| session_turns | principal_kind, principal_id, sender_user_id, sender_external_key, origin, origin_id, parent_run_id, approved_by |
| session_inputs, session_commands, session_interactions | run_envelope |
| trigger_schedules, trigger_subscriptions | principal_kind, principal_id, artifact_id |
| evaluation_runs | principal_kind, principal_id |

Kinds and origins are validated by the application enums, so a later principal kind
needs no schema change. Old pods do not select the new columns and keep working.
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy import text
from sqlalchemy.dialects.postgresql import JSONB, UUID

revision: str = "oss000000046"
down_revision: Union[str, None] = "oss000000045"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _principal_columns():
    return (
        ("principal_kind", sa.String()),
        ("principal_id", UUID(as_uuid=True)),
    )


_COLUMNS = (
    (
        "session_turns",
        (
            *_principal_columns(),
            ("sender_user_id", UUID(as_uuid=True)),
            ("sender_external_key", sa.String()),
            ("origin", sa.String()),
            ("origin_id", sa.String()),
            ("parent_run_id", sa.String()),
            ("approved_by", JSONB()),
        ),
    ),
    ("session_inputs", (("run_envelope", JSONB()),)),
    ("session_commands", (("run_envelope", JSONB()),)),
    ("session_interactions", (("run_envelope", JSONB()),)),
    (
        "trigger_schedules",
        (*_principal_columns(), ("artifact_id", UUID(as_uuid=True))),
    ),
    (
        "trigger_subscriptions",
        (*_principal_columns(), ("artifact_id", UUID(as_uuid=True))),
    ),
    ("evaluation_runs", _principal_columns()),
)

# (index name, table, columns): archiving an agent pauses its triggers by artifact.
_INDEXES = (
    (
        "ix_trigger_schedules_project_id_artifact_id",
        "trigger_schedules",
        "project_id, artifact_id",
    ),
    (
        "ix_trigger_subscriptions_project_id_artifact_id",
        "trigger_subscriptions",
        "project_id, artifact_id",
    ),
)


def upgrade() -> None:
    # Bounded wait for the ALTER TABLE locks; LOCAL ends with this transaction.
    op.execute("SET LOCAL lock_timeout = '5s'")

    for table, columns in _COLUMNS:
        for name, type_ in columns:
            op.add_column(table, sa.Column(name, type_, nullable=True))

    # CREATE INDEX CONCURRENTLY cannot run inside a transaction. Entering the block
    # commits the column changes above.
    with op.get_context().autocommit_block():
        for name, table, columns in _INDEXES:
            op.execute(
                f"CREATE INDEX CONCURRENTLY IF NOT EXISTS {name} ON {table} ({columns})"
            )

            # IF NOT EXISTS skips an invalid index left by an interrupted build, so
            # stop here instead of recording the revision without the index.
            is_valid = (
                op.get_bind()
                .execute(
                    text(
                        "SELECT indisvalid FROM pg_catalog.pg_index "
                        "WHERE indexrelid = pg_catalog.to_regclass(:name)"
                    ),
                    {"name": name},
                )
                .scalar()
            )
            if is_valid is not True:
                raise RuntimeError(
                    f"Index {name} is missing or invalid. Run "
                    f"REINDEX INDEX CONCURRENTLY {name} outside a transaction, "
                    "then rerun the migration."
                )


def downgrade() -> None:
    with op.get_context().autocommit_block():
        for name, table, _ in _INDEXES:
            op.drop_index(
                name,
                table_name=table,
                postgresql_concurrently=True,
                if_exists=True,
            )

    for table, columns in _COLUMNS:
        for name, _ in columns:
            op.drop_column(table, name)
