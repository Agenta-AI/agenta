"""add personal MCP servers: owner columns and an id primary key on mcps_endpoints

A person's own MCP server (M7) is an `mcps_endpoints` row with `organization_id` and
`user_id` set and `project_id` NULL. This revision:

- adds `organization_id` and `user_id` (cascading FKs) and makes `project_id` nullable;
- moves the primary key from `(project_id, id)` to `(id)` (no table references it);
- `ck_mcps_endpoints_owner`: a project row, or a user row;
- `uq_mcps_endpoints_user_slug`: a person's slugs are unique per organization. The
  project slug constraint stays; a NULL project never collides in it.

The unique index on `id` is built concurrently first; the key swap is one short
transaction. No row is rewritten: every existing row is a project row.

The downgrade deletes the personal servers, then restores the composite key.

Revision ID: oss000000058
Revises: oss000000057
Create Date: 2026-10-28 00:00:00.000000
"""

from typing import Sequence, Union

from alembic import op
from sqlalchemy import text

revision: str = "oss000000058"
down_revision: Union[str, None] = "oss000000057"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

_INDEXES = (
    (
        "uq_mcps_endpoints_id",
        "CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS uq_mcps_endpoints_id "
        "ON mcps_endpoints (id)",
    ),
    (
        "uq_mcps_endpoints_user_slug",
        "CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS uq_mcps_endpoints_user_slug "
        "ON mcps_endpoints (organization_id, user_id, slug) WHERE user_id IS NOT NULL",
    ),
)

_OWNER_CHECK = (
    "CHECK ((project_id IS NOT NULL AND organization_id IS NULL AND user_id IS NULL) "
    "OR (project_id IS NULL AND organization_id IS NOT NULL AND user_id IS NOT NULL))"
)

_PRIMARY_KEY_SQL = (
    "SELECT conname, pg_catalog.pg_get_constraintdef(oid) FROM pg_catalog.pg_constraint "
    "WHERE conrelid = pg_catalog.to_regclass('mcps_endpoints') AND contype = 'p'"
)

_CONSTRAINT_EXISTS_SQL = (
    "SELECT 1 FROM pg_catalog.pg_constraint "
    "WHERE conname = :name AND conrelid = pg_catalog.to_regclass('mcps_endpoints')"
)

_INDEX_VALID_SQL = (
    "SELECT indisvalid FROM pg_catalog.pg_index "
    "WHERE indexrelid = pg_catalog.to_regclass(:name)"
)

_CONSTRAINTS = (
    (
        "fk_mcps_endpoints_organization_id",
        "FOREIGN KEY (organization_id) REFERENCES organizations (id) ON DELETE CASCADE",
    ),
    (
        "fk_mcps_endpoints_user_id",
        "FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE",
    ),
    ("ck_mcps_endpoints_owner", _OWNER_CHECK),
)


def _scalar(sql: str, **params):
    return op.get_bind().execute(text(sql), params).scalar()


def _build(name: str, create: str) -> None:
    if _scalar(_INDEX_VALID_SQL, name=name) is False:
        op.execute(f"DROP INDEX CONCURRENTLY IF EXISTS {name}")
    op.execute(create)
    if _scalar(_INDEX_VALID_SQL, name=name) is not True:
        raise RuntimeError(
            f"Index {name} is invalid after its build. Repair it with "
            f"REINDEX INDEX CONCURRENTLY {name}, then rerun the migration."
        )


def upgrade() -> None:
    op.execute("SET LOCAL lock_timeout = '5s'")
    op.execute(
        "ALTER TABLE mcps_endpoints "
        "ADD COLUMN IF NOT EXISTS organization_id UUID, "
        "ADD COLUMN IF NOT EXISTS user_id UUID"
    )
    for name, definition in _CONSTRAINTS:
        if _scalar(_CONSTRAINT_EXISTS_SQL, name=name) is None:
            op.execute(
                f"ALTER TABLE mcps_endpoints ADD CONSTRAINT {name} {definition} NOT VALID"
            )

    with op.get_context().autocommit_block():
        for name, create in _INDEXES:
            _build(name, create)

    op.execute("SET LOCAL lock_timeout = '5s'")
    primary = op.get_bind().execute(text(_PRIMARY_KEY_SQL)).first()
    if primary is not None and "project_id" in primary[1]:
        op.execute(f"ALTER TABLE mcps_endpoints DROP CONSTRAINT {primary[0]}")
    if _scalar(_CONSTRAINT_EXISTS_SQL, name="pk_mcps_endpoints") is None:
        op.execute(
            "ALTER TABLE mcps_endpoints ADD CONSTRAINT pk_mcps_endpoints "
            "PRIMARY KEY USING INDEX uq_mcps_endpoints_id"
        )
    op.execute("ALTER TABLE mcps_endpoints ALTER COLUMN project_id DROP NOT NULL")

    with op.get_context().autocommit_block():
        for name, _ in _CONSTRAINTS:
            op.execute(f"ALTER TABLE mcps_endpoints VALIDATE CONSTRAINT {name}")


def downgrade() -> None:
    op.execute("SET LOCAL lock_timeout = '5s'")
    op.execute("DELETE FROM mcps_endpoints WHERE user_id IS NOT NULL")
    op.execute("ALTER TABLE mcps_endpoints DROP CONSTRAINT IF EXISTS pk_mcps_endpoints")
    op.execute("ALTER TABLE mcps_endpoints ALTER COLUMN project_id SET NOT NULL")
    op.execute(
        "ALTER TABLE mcps_endpoints ADD CONSTRAINT mcps_endpoints_pkey "
        "PRIMARY KEY (project_id, id)"
    )
    for name, _ in reversed(_CONSTRAINTS):
        op.execute(f"ALTER TABLE mcps_endpoints DROP CONSTRAINT IF EXISTS {name}")
    op.execute("DROP INDEX IF EXISTS uq_mcps_endpoints_user_slug")
    op.execute(
        "ALTER TABLE mcps_endpoints DROP COLUMN IF EXISTS user_id, "
        "DROP COLUMN IF EXISTS organization_id"
    )
