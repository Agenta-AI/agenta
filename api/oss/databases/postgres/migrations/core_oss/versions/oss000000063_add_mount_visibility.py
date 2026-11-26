"""add the drive visibility table and one drive per agent

Revision ID: oss000000063
Revises: oss000000062
Create Date: 2026-11-17 00:00:00.000000

Release 1 of drive sharing (expand). A drive (a `mounts` row) gets its own visibility,
`private` or `project`, like an agent. No agent drive row changes: existing agent
drives keep their reserved slugs and follow their agents until release 2 writes their
rows.

| Object | Change |
| --- | --- |
| mount_visibility | NEW table: one row per drive. A row with `project` may have no owner. |
| mount_visibility rows | `project`, no owner, for every drive with no session and no agent. Older API pods do not read the table. |
| mounts | NEW unique partial index uq_mounts_project_id_agent_id; it replaces ix_mounts_project_id_agent_id. |

The unique index fails when two rows share `(project_id, agent_id)`. The revision
checks this first and stops with the pairs it found, before it changes anything.

Rerun. Entering the autocommit block commits the table and its rows, so a rerun after a
failure in the block finds them. Every statement is `IF NOT EXISTS`, `IF EXISTS` or
`ON CONFLICT DO NOTHING`, so the rerun is safe.
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy import text
from sqlalchemy.dialects import postgresql

revision: str = "oss000000063"
down_revision: Union[str, None] = "oss000000062"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


_UNIQUE_INDEX = "uq_mounts_project_id_agent_id"
_OLD_INDEX = "ix_mounts_project_id_agent_id"

_DUPLICATE_AGENT_DRIVES_SQL = """
SELECT project_id, agent_id, COUNT(*) AS rows
FROM mounts
WHERE agent_id IS NOT NULL
GROUP BY project_id, agent_id
HAVING COUNT(*) > 1
ORDER BY project_id, agent_id
LIMIT 20
"""

_INSERT_PROJECT_ROWS_SQL = """
INSERT INTO mount_visibility (project_id, mount_id, visibility, owner_user_id)
SELECT m.project_id, m.id, 'project', NULL
FROM mounts m
WHERE m.session_id IS NULL AND m.agent_id IS NULL
ON CONFLICT (project_id, mount_id) DO NOTHING
"""

_CREATE_UNIQUE_INDEX_SQL = (
    f"CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS {_UNIQUE_INDEX} "
    "ON mounts (project_id, agent_id) WHERE agent_id IS NOT NULL"
)

_DROP_OLD_INDEX_SQL = f"DROP INDEX CONCURRENTLY IF EXISTS {_OLD_INDEX}"


def _create_table() -> None:
    op.create_table(
        "mount_visibility",
        sa.Column("project_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("mount_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("visibility", sa.String(), nullable=False),
        sa.Column("owner_user_id", postgresql.UUID(as_uuid=True), nullable=True),
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
        sa.PrimaryKeyConstraint("project_id", "mount_id"),
        sa.ForeignKeyConstraint(
            ["project_id", "mount_id"],
            ["mounts.project_id", "mounts.id"],
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["project_id"],
            ["projects.id"],
            ondelete="CASCADE",
        ),
        sa.CheckConstraint(
            "visibility IN ('private', 'project')",
            name="ck_mount_visibility_value",
        ),
        sa.CheckConstraint(
            "visibility <> 'private' OR owner_user_id IS NOT NULL",
            name="ck_mount_visibility_private_owner",
        ),
        if_not_exists=True,
    )
    op.create_index(
        "ix_mount_visibility_project_id_owner_user_id",
        "mount_visibility",
        ["project_id", "owner_user_id"],
        if_not_exists=True,
    )


def _stop_on_duplicate_agent_drives() -> None:
    duplicates = op.get_bind().execute(text(_DUPLICATE_AGENT_DRIVES_SQL)).fetchall()
    if duplicates:
        pairs = ", ".join(
            f"(project {row.project_id}, agent {row.agent_id}: {row.rows} rows)"
            for row in duplicates
        )
        raise RuntimeError(
            "Two or more mounts rows share one (project_id, agent_id), so the unique "
            f"index {_UNIQUE_INDEX} cannot be built. Keep one drive per agent, then "
            f"rerun the migration. First pairs found: {pairs}"
        )


def upgrade() -> None:
    _stop_on_duplicate_agent_drives()

    # A new, empty table: its plain index blocks nothing.
    _create_table()
    op.execute(_INSERT_PROJECT_ROWS_SQL)

    # Entering the block commits everything above; concurrent builds let writes run.
    with op.get_context().autocommit_block():
        op.execute(_CREATE_UNIQUE_INDEX_SQL)

        # IF NOT EXISTS skips an invalid index left by an interrupted build, so stop
        # here instead of recording the revision without the index.
        is_valid = (
            op.get_bind()
            .execute(
                text(
                    "SELECT indisvalid FROM pg_catalog.pg_index "
                    "WHERE indexrelid = pg_catalog.to_regclass(:name)"
                ),
                {"name": _UNIQUE_INDEX},
            )
            .scalar()
        )
        if is_valid is not True:
            raise RuntimeError(
                f"Index {_UNIQUE_INDEX} is missing or invalid. Run "
                f"DROP INDEX CONCURRENTLY {_UNIQUE_INDEX} outside a transaction, "
                "keep one drive per agent, then rerun the migration."
            )

        op.execute(_DROP_OLD_INDEX_SQL)


def downgrade() -> None:
    with op.get_context().autocommit_block():
        op.execute(
            f"CREATE INDEX CONCURRENTLY IF NOT EXISTS {_OLD_INDEX} "
            "ON mounts (project_id, agent_id) WHERE agent_id IS NOT NULL"
        )
        op.execute(f"DROP INDEX CONCURRENTLY IF EXISTS {_UNIQUE_INDEX}")
    op.drop_table("mount_visibility", if_exists=True)
