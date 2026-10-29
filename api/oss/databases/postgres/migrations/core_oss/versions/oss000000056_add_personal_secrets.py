"""add personal secrets: secrets.user_id, owner and kind checks, owner slug spaces

A person's own account is a `secrets` row with `organization_id` and `user_id` set and
`project_id` NULL. Its owner is the person, inside one organization. This revision adds:

- `secrets.user_id`, a cascading FK to `users`.
- `ck_secrets_single_owner` now allows a project row, an organization row, or a person's
  row (organization and user). Every existing row is a project or an organization row.
- `ck_secrets_user_kinds`: a person's row is a custom secret, a subscription login, an
  MCP OAuth grant or an MCP token.
- `uq_secrets_organization_id_slug` is rebuilt without person rows, so a person's slug
  never collides with the organization's or another person's.
- `uq_secrets_user_slug`: a person's slugs are unique per organization.

The FK and the checks are added NOT VALID in one transaction under a short lock timeout,
and validated in an autocommit block. The organization slug index is rebuilt
concurrently under a temporary name while the old one still guards, then swapped in.

Old code on the new schema: it never writes `user_id`, and the M5 organization reads
(`project_id IS NULL`) would read a person's row as an organization row. No person row
exists until the deployment switch `AGENTA_ACCESS_PERSONAL_ACCOUNTS_ENABLED` is on, which
needs every API pod on this release.

The downgrade deletes the person rows, then restores the M5 index and check.

Revision ID: oss000000056
Revises: oss000000055
Create Date: 2026-10-29 00:00:00.000000
"""

import logging
from typing import Sequence, Union

from alembic import op
from sqlalchemy import text

revision: str = "oss000000056"
down_revision: Union[str, None] = "oss000000055"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

log = logging.getLogger("alembic.runtime.migration")

_ADD_USER_ID_SQL = "ALTER TABLE secrets ADD COLUMN IF NOT EXISTS user_id UUID"

# Postgres enum labels are the member NAMES.
_CONSTRAINTS = (
    (
        "fk_secrets_user_id",
        "FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE",
    ),
    (
        "ck_secrets_single_owner",
        "CHECK ((project_id IS NOT NULL AND organization_id IS NULL "
        "AND user_id IS NULL) OR (project_id IS NULL AND organization_id IS NOT NULL))",
    ),
    (
        "ck_secrets_user_kinds",
        "CHECK (user_id IS NULL OR kind IN "
        "('CUSTOM_SECRET', 'SUBSCRIPTION_PROVIDER', 'OAUTH_GRANT', 'MCP_TOKEN'))",
    ),
)

_M5_SINGLE_OWNER = "CHECK (num_nonnulls(project_id, organization_id) = 1)"

_INDEXES = (
    (
        "uq_secrets_organization_id_slug",
        "CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS uq_secrets_organization_id_slug "
        "ON secrets (organization_id, slug) "
        "WHERE project_id IS NULL AND user_id IS NULL AND slug IS NOT NULL",
    ),
    (
        "uq_secrets_user_slug",
        "CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS uq_secrets_user_slug "
        "ON secrets (organization_id, user_id, slug) WHERE user_id IS NOT NULL",
    ),
)

_NEXT_ORGANIZATION_SLUG_INDEX = "uq_secrets_organization_id_slug_next"
_NEXT_ORGANIZATION_SLUG_CREATE = (
    "CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS uq_secrets_organization_id_slug_next "
    "ON secrets (organization_id, slug) "
    "WHERE project_id IS NULL AND user_id IS NULL AND slug IS NOT NULL"
)

_M5_ORGANIZATION_SLUG_INDEX = (
    "CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS uq_secrets_organization_id_slug "
    "ON secrets (organization_id, slug) WHERE project_id IS NULL AND slug IS NOT NULL"
)

_INDEX_PREDICATE_SQL = (
    "SELECT pg_catalog.pg_get_expr(indpred, indrelid) FROM pg_catalog.pg_index "
    "WHERE indexrelid = pg_catalog.to_regclass(:name)"
)

_INDEX_VALID_SQL = (
    "SELECT indisvalid FROM pg_catalog.pg_index "
    "WHERE indexrelid = pg_catalog.to_regclass(:name)"
)

_CONSTRAINT_DEF_SQL = (
    "SELECT pg_catalog.pg_get_constraintdef(oid) FROM pg_catalog.pg_constraint "
    "WHERE conname = :name AND conrelid = pg_catalog.to_regclass('secrets')"
)

_DELETE_USER_ROWS_SQL = "DELETE FROM secrets WHERE user_id IS NOT NULL"


def _constraint_def(name: str):
    return op.get_bind().execute(text(_CONSTRAINT_DEF_SQL), {"name": name}).scalar()


def _index_valid(name: str):
    """True or False for an existing index, None when there is none."""
    return op.get_bind().execute(text(_INDEX_VALID_SQL), {"name": name}).scalar()


def _index_predicate(name: str):
    return op.get_bind().execute(text(_INDEX_PREDICATE_SQL), {"name": name}).scalar()


def _build(name: str, create: str) -> None:
    # IF NOT EXISTS would skip an INVALID index left by an interrupted build.
    if _index_valid(name) is False:
        op.execute(f"DROP INDEX CONCURRENTLY IF EXISTS {name}")
    op.execute(create)
    if _index_valid(name) is not True:
        raise RuntimeError(
            f"Index {name} is invalid after its build. Repair it with "
            f"REINDEX INDEX CONCURRENTLY {name}, then rerun the migration."
        )


def upgrade() -> None:
    # Fail fast instead of queueing behind long transactions; the deploy is retried.
    op.execute("SET LOCAL lock_timeout = '5s'")

    op.execute(_ADD_USER_ID_SQL)
    for name, definition in _CONSTRAINTS:
        current = _constraint_def(name)
        if current is not None and "user_id" in current:
            continue  # already the new form (a rerun)
        if current is not None:
            op.execute(f"ALTER TABLE secrets DROP CONSTRAINT {name}")
        op.execute(f"ALTER TABLE secrets ADD CONSTRAINT {name} {definition} NOT VALID")

    with op.get_context().autocommit_block():
        # The M5 organization slug index counts every row with no project. Its
        # replacement (without user rows) is built under a temporary name while the old
        # one still guards organization slugs, then swapped in. A rerun finds the new
        # predicate on the real name and keeps it.
        name, create = _INDEXES[0]
        predicate = _index_predicate(name)
        if predicate is not None and "user_id" not in predicate:
            _build(_NEXT_ORGANIZATION_SLUG_INDEX, _NEXT_ORGANIZATION_SLUG_CREATE)
            op.execute(f"DROP INDEX CONCURRENTLY IF EXISTS {name}")
        if _index_valid(_NEXT_ORGANIZATION_SLUG_INDEX) is True:
            op.execute(f"ALTER INDEX {_NEXT_ORGANIZATION_SLUG_INDEX} RENAME TO {name}")
        for name, create in _INDEXES:
            _build(name, create)

        for name, _ in _CONSTRAINTS:
            op.execute(f"ALTER TABLE secrets VALIDATE CONSTRAINT {name}")


def downgrade() -> None:
    deleted = op.get_bind().execute(text(_DELETE_USER_ROWS_SQL)).rowcount
    log.info("[secrets] deleted %s personal rows", deleted)

    with op.get_context().autocommit_block():
        op.execute("DROP INDEX CONCURRENTLY IF EXISTS uq_secrets_user_slug")
        op.execute("DROP INDEX CONCURRENTLY IF EXISTS uq_secrets_organization_id_slug")
        _build("uq_secrets_organization_id_slug", _M5_ORGANIZATION_SLUG_INDEX)

    op.execute("ALTER TABLE secrets DROP CONSTRAINT IF EXISTS ck_secrets_user_kinds")
    op.execute("ALTER TABLE secrets DROP CONSTRAINT IF EXISTS ck_secrets_single_owner")
    op.execute(
        f"ALTER TABLE secrets ADD CONSTRAINT ck_secrets_single_owner {_M5_SINGLE_OWNER}"
    )
    op.execute("ALTER TABLE secrets DROP CONSTRAINT IF EXISTS fk_secrets_user_id")
    op.execute("ALTER TABLE secrets DROP COLUMN IF EXISTS user_id")
