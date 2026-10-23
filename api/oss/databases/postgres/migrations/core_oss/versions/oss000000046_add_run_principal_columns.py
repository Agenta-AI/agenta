"""add the run principal columns

Revision ID: oss000000046
Revises: oss000000045
Create Date: 2026-10-23 00:00:00.000000

Every run gets a principal (human, api_key or installation), a run context, and on a
turn its sender and approver. This revision is the short schema expansion; the backfill
of existing schedules, subscriptions and evaluation runs is `oss000000047`, a separate
revision of the same release.

Every column is nullable, with no default, no foreign key and no check constraint, so
each `ADD COLUMN` is a catalog change only. Each table is altered in its own short
transaction (one `ALTER TABLE` per table, in an autocommit block), so no table keeps
its `ACCESS EXCLUSIVE` lock while another table waits for its own. `lock_timeout`
bounds each wait: a long-running transaction on one of these tables fails the hook after
5 s instead of queueing every other query behind the `ALTER TABLE`, and the deploy is
re-run. A rerun after a failure part-way completes: every `ADD COLUMN` is
`IF NOT EXISTS`. The two indexes are built CONCURRENTLY afterwards.

| Table | Columns |
| --- | --- |
| session_turns | principal_kind, principal_id, sender_user_id, sender_external_key, origin, origin_id, parent_run_id, approved_by |
| session_inputs, session_commands, session_interactions | run_envelope |
| trigger_schedules, trigger_subscriptions | principal_kind, principal_id, artifact_id |
| evaluation_runs | principal_kind, principal_id, principal_user_id |

Kinds and origins are validated by the application enums, so a later principal kind
needs no schema change. Old pods do not select the new columns and keep working.
"""

from typing import Sequence, Union

from alembic import op
from sqlalchemy import text

revision: str = "oss000000046"
down_revision: Union[str, None] = "oss000000045"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _principal_columns():
    return (
        ("principal_kind", "VARCHAR"),
        ("principal_id", "UUID"),
    )


_COLUMNS = (
    (
        "session_turns",
        (
            *_principal_columns(),
            ("sender_user_id", "UUID"),
            ("sender_external_key", "VARCHAR"),
            ("origin", "VARCHAR"),
            ("origin_id", "VARCHAR"),
            ("parent_run_id", "VARCHAR"),
            ("approved_by", "JSONB"),
        ),
    ),
    ("session_inputs", (("run_envelope", "JSONB"),)),
    ("session_commands", (("run_envelope", "JSONB"),)),
    ("session_interactions", (("run_envelope", "JSONB"),)),
    (
        "trigger_schedules",
        (*_principal_columns(), ("artifact_id", "UUID")),
    ),
    (
        "trigger_subscriptions",
        (*_principal_columns(), ("artifact_id", "UUID")),
    ),
    ("evaluation_runs", (*_principal_columns(), ("principal_user_id", "UUID"))),
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


def _alter_statements():
    """One `ALTER TABLE` per table, every column `ADD COLUMN IF NOT EXISTS`."""

    return [
        f"ALTER TABLE {table} "
        + ", ".join(
            f"ADD COLUMN IF NOT EXISTS {name} {type_}" for name, type_ in columns
        )
        for table, columns in _COLUMNS
    ]


def upgrade() -> None:
    # Autocommit: each ALTER TABLE is its own short transaction. The session-level
    # lock_timeout bounds each one's wait for its ACCESS EXCLUSIVE lock; it is reset
    # before the index builds, which keep the server default.
    with op.get_context().autocommit_block():
        op.execute("SET lock_timeout = '5s'")
        try:
            for statement in _alter_statements():
                op.execute(statement)
        finally:
            op.execute("RESET lock_timeout")

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
            op.execute(f"ALTER TABLE {table} DROP COLUMN IF EXISTS {name}")
