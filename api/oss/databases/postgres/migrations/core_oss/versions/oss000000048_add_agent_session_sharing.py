"""add the agent and session sharing schema

Revision ID: oss000000048
Revises: oss000000050
Create Date: 2026-10-23 00:00:00.000000

Agents and sessions get a visibility (`private` or `project`) and an owner. This
revision is the short schema expansion; the one-time backfill of existing agents and
sessions is `oss000000049`, a separate revision of the same release.

| Object | Change |
| --- | --- |
| agent_access | NEW table: one row per agent that has an owner. No row = project-visible, ownerless. |
| session_grants | NEW table: named Viewer and Participant grants on a session. |
| session_streams | NEW nullable columns visibility, owner_user_id; check ck_session_streams_visibility_owner; index ix_session_streams_project_id_owner_user_id. |
| session_trace_tombstones | NEW table: one row per deleted private session (its former owner). The session-trace-privacy design (M9) defines it; M3 writes it, so a deleted private session stays hidden from everyone but its former owner. |

`session_streams.visibility IS NULL` marks a row written by pre-sharing code (old pods
during the rolling deploy); it reads as project-visible. A null owner is never a marker.

Locks. `lock_timeout` bounds the wait for the `ACCESS EXCLUSIVE` lock of the
`ALTER TABLE`: a long-running transaction on `session_streams` fails the hook after 5 s
instead of queueing every other query behind it, and the deploy is rerun. The
`ACCESS EXCLUSIVE` phase is catalog-only: two nullable columns with no default, and the
check constraint added `NOT VALID`. Entering the autocommit block commits that phase;
`VALIDATE CONSTRAINT` (`SHARE UPDATE EXCLUSIVE`, writes keep running) and the concurrent
index run after it.

Rerun. Entering the autocommit block commits the tables, the columns and the
constraint, so a rerun after a failure in the block finds them. Every statement is
`IF NOT EXISTS` or guarded, so the rerun is safe.
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy import text
from sqlalchemy.dialects import postgresql

revision: str = "oss000000048"
down_revision: Union[str, None] = "oss000000050"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


_CONSTRAINT = "ck_session_streams_visibility_owner"
_INDEX = "ix_session_streams_project_id_owner_user_id"

_ADD_COLUMNS = (
    "ALTER TABLE session_streams ADD COLUMN IF NOT EXISTS visibility VARCHAR",
    "ALTER TABLE session_streams ADD COLUMN IF NOT EXISTS owner_user_id UUID",
)

# PostgreSQL has no ADD CONSTRAINT IF NOT EXISTS; the guard reads the catalog.
_ADD_CONSTRAINT = f"""
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_catalog.pg_constraint
        WHERE conname = '{_CONSTRAINT}'
          AND conrelid = 'session_streams'::regclass
    ) THEN
        ALTER TABLE session_streams ADD CONSTRAINT {_CONSTRAINT} CHECK (
            (visibility IS NULL OR visibility IN ('private', 'project'))
            AND (visibility IS DISTINCT FROM 'private' OR owner_user_id IS NOT NULL)
        ) NOT VALID;
    END IF;
END
$$;
"""

_VALIDATE_CONSTRAINT = f"ALTER TABLE session_streams VALIDATE CONSTRAINT {_CONSTRAINT}"

_CREATE_INDEX = (
    f"CREATE INDEX CONCURRENTLY IF NOT EXISTS {_INDEX} "
    "ON session_streams (project_id, owner_user_id)"
)


def _lifecycle_columns():
    return (
        sa.Column(
            "created_at",
            sa.TIMESTAMP(timezone=True),
            server_default=sa.text("CURRENT_TIMESTAMP"),
            nullable=True,
        ),
        sa.Column("updated_at", sa.TIMESTAMP(timezone=True), nullable=True),
        sa.Column("deleted_at", sa.TIMESTAMP(timezone=True), nullable=True),
        sa.Column("created_by_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("updated_by_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("deleted_by_id", postgresql.UUID(as_uuid=True), nullable=True),
    )


def _create_tables() -> None:
    op.create_table(
        "agent_access",
        sa.Column("project_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("artifact_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("visibility", sa.String(), nullable=False),
        sa.Column("owner_user_id", postgresql.UUID(as_uuid=True), nullable=False),
        *_lifecycle_columns(),
        sa.PrimaryKeyConstraint("project_id", "artifact_id"),
        sa.ForeignKeyConstraint(
            ["project_id", "artifact_id"],
            ["workflow_artifacts.project_id", "workflow_artifacts.id"],
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["project_id"],
            ["projects.id"],
            ondelete="CASCADE",
        ),
        sa.CheckConstraint(
            "visibility IN ('private', 'project')",
            name="ck_agent_access_visibility",
        ),
        if_not_exists=True,
    )
    op.create_index(
        "ix_agent_access_project_id_owner_user_id",
        "agent_access",
        ["project_id", "owner_user_id"],
        if_not_exists=True,
    )

    op.create_table(
        "session_grants",
        sa.Column("project_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("stream_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("user_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("role", sa.String(), nullable=False),
        sa.Column(
            "created_at",
            sa.TIMESTAMP(timezone=True),
            server_default=sa.text("CURRENT_TIMESTAMP"),
            nullable=True,
        ),
        sa.Column("created_by_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.PrimaryKeyConstraint("project_id", "stream_id", "user_id"),
        sa.ForeignKeyConstraint(
            ["project_id", "stream_id"],
            ["session_streams.project_id", "session_streams.id"],
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["user_id"],
            ["users.id"],
            ondelete="CASCADE",
        ),
        sa.CheckConstraint(
            "role IN ('viewer', 'participant')",
            name="ck_session_grants_role",
        ),
        if_not_exists=True,
    )
    op.create_index(
        "ix_session_grants_project_id_user_id",
        "session_grants",
        ["project_id", "user_id"],
        if_not_exists=True,
    )

    # No foreign key to session_streams: the tombstone outlives the row it replaces.
    op.create_table(
        "session_trace_tombstones",
        sa.Column("project_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("session_id", sa.String(), nullable=False),
        sa.Column("owner_user_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column(
            "deleted_at",
            sa.TIMESTAMP(timezone=True),
            server_default=sa.text("CURRENT_TIMESTAMP"),
            nullable=True,
        ),
        sa.PrimaryKeyConstraint("project_id", "session_id"),
        sa.ForeignKeyConstraint(
            ["project_id"],
            ["projects.id"],
            ondelete="CASCADE",
        ),
        if_not_exists=True,
    )


def upgrade() -> None:
    # Bounded wait for the ALTER TABLE lock; LOCAL ends with this transaction.
    op.execute("SET LOCAL lock_timeout = '5s'")

    # New, empty tables: their plain indexes block nothing.
    _create_tables()

    for statement in _ADD_COLUMNS:
        op.execute(statement)
    op.execute(_ADD_CONSTRAINT)

    # Entering the block commits everything above, so the ACCESS EXCLUSIVE lock is
    # released before the table scan of VALIDATE and the index build.
    with op.get_context().autocommit_block():
        op.execute(_VALIDATE_CONSTRAINT)
        op.execute(_CREATE_INDEX)

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
                f"REINDEX INDEX CONCURRENTLY {_INDEX} outside a transaction, "
                "then rerun the migration."
            )


def downgrade() -> None:
    with op.get_context().autocommit_block():
        op.drop_index(
            _INDEX,
            table_name="session_streams",
            postgresql_concurrently=True,
            if_exists=True,
        )

    op.execute(f"ALTER TABLE session_streams DROP CONSTRAINT IF EXISTS {_CONSTRAINT}")
    op.execute("ALTER TABLE session_streams DROP COLUMN IF EXISTS owner_user_id")
    op.execute("ALTER TABLE session_streams DROP COLUMN IF EXISTS visibility")
    op.drop_table("session_trace_tombstones", if_exists=True)
    op.drop_index(
        "ix_session_grants_project_id_user_id",
        table_name="session_grants",
        if_exists=True,
    )
    op.drop_table("session_grants", if_exists=True)
    op.drop_index(
        "ix_agent_access_project_id_owner_user_id",
        table_name="agent_access",
        if_exists=True,
    )
    op.drop_table("agent_access", if_exists=True)
