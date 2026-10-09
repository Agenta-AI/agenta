"""index the membership tables and the api-key lookup

Revision ID: oss000000040
Revises: oss000000039
Create Date: 2026-10-09 00:00:00.000000

Every permission check reads `organization_members`, `workspace_members` and
`project_members` by `(user_id, <scope_id>)` or by the scope id alone, and every
api-key request reads `api_keys` by `hashed_key`. All four tables carried one
index, on `id`, so each of those reads was a sequential scan. In EU production
the membership tables held 37,879, 37,890 and 89,238 rows and one prompt fetch
ran four to five of those scans.

The six membership indexes already exist on both production instances, created
online on 2026-10-08. They are named here exactly as they were created there, so
`IF NOT EXISTS` makes this revision a no-op on production and creates them on
every other database. `ix_api_keys_hashed_key` is new everywhere.

CONCURRENTLY does not take the write lock, so a large table stays writable while
the index builds. An interrupted concurrent build leaves an invalid index that
`IF NOT EXISTS` then skips, which this revision cannot safely repair: dropping
the name first would drop the valid production index and rebuild it under load.
Repair an invalid index by hand, with `REINDEX INDEX CONCURRENTLY <name>`.
"""

from typing import Sequence, Union

from alembic import op

revision: str = "oss000000040"
down_revision: Union[str, None] = "oss000000039"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


# (index name, table, columns) — the membership pairs serve the `(user_id, scope)`
# lookup one access check makes; the single-column ones serve listing a scope's
# members.
_INDEXES = (
    (
        "ix_organization_members_user_id_organization_id",
        "organization_members",
        "user_id, organization_id",
    ),
    (
        "ix_organization_members_organization_id",
        "organization_members",
        "organization_id",
    ),
    (
        "ix_workspace_members_user_id_workspace_id",
        "workspace_members",
        "user_id, workspace_id",
    ),
    (
        "ix_workspace_members_workspace_id",
        "workspace_members",
        "workspace_id",
    ),
    (
        "ix_project_members_user_id_project_id",
        "project_members",
        "user_id, project_id",
    ),
    (
        "ix_project_members_project_id",
        "project_members",
        "project_id",
    ),
    # `is_valid_api_key` resolves every api-key request by this one column. The
    # stored value is "<prefix>.<sha256>", so it is effectively unique, but the
    # index is not declared unique: a duplicate row would fail the build on a
    # live database and the uniqueness buys nothing here.
    (
        "ix_api_keys_hashed_key",
        "api_keys",
        "hashed_key",
    ),
)


def upgrade() -> None:
    # CREATE INDEX CONCURRENTLY cannot run inside a transaction.
    with op.get_context().autocommit_block():
        for name, table, columns in _INDEXES:
            op.execute(
                f"CREATE INDEX CONCURRENTLY IF NOT EXISTS {name} ON {table} ({columns})"
            )

        # Without fresh statistics the planner can keep the sequential scan it
        # already costed, which is the slow plan this revision exists to retire.
        for table in dict.fromkeys(table for _, table, _ in _INDEXES):
            op.execute(f"ANALYZE {table}")


def downgrade() -> None:
    with op.get_context().autocommit_block():
        for name, table, _ in _INDEXES:
            op.drop_index(
                name,
                table_name=table,
                postgresql_concurrently=True,
                if_exists=True,
            )
