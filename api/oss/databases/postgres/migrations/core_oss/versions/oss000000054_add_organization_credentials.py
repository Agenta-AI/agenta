"""add organization credentials: availability, single owner, organization slugs, secret_projects

Organization credentials are `secrets` rows with `organization_id` set and `project_id`
NULL, which an agent of a chosen project uses when it names one. This revision adds what
that needs:

- `secrets.availability` (`all_projects` or `selected_projects`), read only for
  organization rows, and the table `secret_projects` that lists the selected projects.
- `ck_secrets_single_owner`: exactly one of `project_id` and `organization_id` is set. The
  DAO already writes only such rows. Rows with neither are deleted first: no reader can
  resolve them. The count is logged.
- `uq_secrets_organization_id_slug`: organization slugs are unique in the organization,
  as project slugs are in the project. SSO rows have no slug, so they never collide.
- `ix_secrets_organization_id`: the organization list read.

The first part runs in one transaction under a short lock timeout. A row that names both
owners, or a duplicate organization slug, stops the upgrade there with a message, and the
stop rolls the orphan delete back with everything else. The indexes are built
concurrently and the constraints validated in an autocommit block, so writes continue.

Rerun after an interruption: the first part is committed and `alembic_version` is not.
Every statement of the first part is a no-op the second time. An index left INVALID by an
interrupted concurrent build is dropped concurrently and built again; an index still
invalid after the build stops the upgrade with the repair instruction.

Old code on the new schema: it ignores the column and the table, and it writes only rows
with one owner, which the constraint accepts.

The downgrade deletes the organization connections (organization rows of the kinds this
revision made shareable; SSO rows and project rows stay) before it drops the column and
the table. Kept, they would come back on a later upgrade available to every project,
whatever projects they were limited to. A rollback loses the organization connections.

Revision ID: oss000000054
Revises: oss000000052
Create Date: 2026-10-25 00:00:00.000000
"""

import logging
from typing import Sequence, Union

from alembic import op
from sqlalchemy import text

revision: str = "oss000000054"
down_revision: Union[str, None] = "oss000000052"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

log = logging.getLogger("alembic.runtime.migration")

_ADD_AVAILABILITY_SQL = (
    "ALTER TABLE secrets ADD COLUMN IF NOT EXISTS availability VARCHAR "
    "NOT NULL DEFAULT 'all_projects'"
)

_CONSTRAINTS = (
    (
        "ck_secrets_availability",
        "CHECK (availability IN ('all_projects', 'selected_projects'))",
    ),
    (
        "ck_secrets_single_owner",
        "CHECK (num_nonnulls(project_id, organization_id) = 1)",
    ),
)

_CREATE_SECRET_PROJECTS_SQL = """
CREATE TABLE IF NOT EXISTS secret_projects (
    secret_id UUID NOT NULL,
    project_id UUID NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE,
    deleted_at TIMESTAMP WITH TIME ZONE,
    created_by_id UUID,
    updated_by_id UUID,
    deleted_by_id UUID,
    CONSTRAINT pk_secret_projects PRIMARY KEY (secret_id, project_id),
    CONSTRAINT fk_secret_projects_secret_id FOREIGN KEY (secret_id)
        REFERENCES secrets (id) ON DELETE CASCADE,
    CONSTRAINT fk_secret_projects_project_id FOREIGN KEY (project_id)
        REFERENCES projects (id) ON DELETE CASCADE
)
"""

_CREATE_SECRET_PROJECTS_INDEX_SQL = (
    "CREATE INDEX IF NOT EXISTS ix_secret_projects_project_id "
    "ON secret_projects (project_id)"
)

_DELETE_ORPHANS_SQL = (
    "DELETE FROM secrets WHERE project_id IS NULL AND organization_id IS NULL"
)

# The kinds an organization may share (provider_key, custom_provider,
# subscription_provider). Postgres enum labels are the member NAMES.
_DELETE_ORGANIZATION_CONNECTIONS_SQL = (
    "DELETE FROM secrets WHERE project_id IS NULL AND organization_id IS NOT NULL "
    "AND kind IN ('PROVIDER_KEY', 'CUSTOM_PROVIDER', 'SUBSCRIPTION_PROVIDER')"
)

_COUNT_BOTH_OWNERS_SQL = (
    "SELECT count(*) FROM secrets "
    "WHERE project_id IS NOT NULL AND organization_id IS NOT NULL"
)

_COUNT_DUPLICATE_ORGANIZATION_SLUGS_SQL = (
    "SELECT count(*) FROM (SELECT 1 FROM secrets "
    "WHERE project_id IS NULL AND slug IS NOT NULL "
    "GROUP BY organization_id, slug HAVING count(*) > 1) duplicates"
)

_INDEXES = (
    (
        "uq_secrets_organization_id_slug",
        "CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS uq_secrets_organization_id_slug "
        "ON secrets (organization_id, slug) "
        "WHERE project_id IS NULL AND slug IS NOT NULL",
    ),
    (
        "ix_secrets_organization_id",
        "CREATE INDEX CONCURRENTLY IF NOT EXISTS ix_secrets_organization_id "
        "ON secrets (organization_id) WHERE project_id IS NULL",
    ),
)

_INDEX_VALID_SQL = (
    "SELECT indisvalid FROM pg_catalog.pg_index "
    "WHERE indexrelid = pg_catalog.to_regclass(:name)"
)

_CONSTRAINT_EXISTS_SQL = (
    "SELECT 1 FROM pg_catalog.pg_constraint "
    "WHERE conname = :name AND conrelid = pg_catalog.to_regclass('secrets')"
)


def _constraint_exists(name: str) -> bool:
    return (
        op.get_bind().execute(text(_CONSTRAINT_EXISTS_SQL), {"name": name}).scalar()
        is not None
    )


def _index_valid(name: str):
    """True or False for an existing index, None when there is none."""
    return op.get_bind().execute(text(_INDEX_VALID_SQL), {"name": name}).scalar()


def upgrade() -> None:
    conn = op.get_bind()

    # Fail fast instead of queueing behind long transactions; the deploy is retried.
    op.execute("SET LOCAL lock_timeout = '5s'")

    op.execute(_ADD_AVAILABILITY_SQL)
    name, check = _CONSTRAINTS[0]
    if not _constraint_exists(name):
        op.execute(f"ALTER TABLE secrets ADD CONSTRAINT {name} {check} NOT VALID")

    op.execute(_CREATE_SECRET_PROJECTS_SQL)
    op.execute(_CREATE_SECRET_PROJECTS_INDEX_SQL)

    deleted = conn.execute(text(_DELETE_ORPHANS_SQL)).rowcount
    log.info("[secrets] deleted %s rows with no owner", deleted)

    both = conn.execute(text(_COUNT_BOTH_OWNERS_SQL)).scalar()
    if both:
        raise RuntimeError(
            f"{both} secrets rows name a project and an organization. "
            "Fix them before this migration."
        )

    duplicates = conn.execute(text(_COUNT_DUPLICATE_ORGANIZATION_SLUGS_SQL)).scalar()
    if duplicates:
        raise RuntimeError(
            f"{duplicates} organization slugs are used twice. "
            "Rename them before this migration."
        )

    name, check = _CONSTRAINTS[1]
    if not _constraint_exists(name):
        op.execute(f"ALTER TABLE secrets ADD CONSTRAINT {name} {check} NOT VALID")

    # CREATE INDEX CONCURRENTLY cannot run inside a transaction. Entering the block
    # commits the part above.
    with op.get_context().autocommit_block():
        for name, create in _INDEXES:
            # IF NOT EXISTS would skip an INVALID index left by an interrupted build,
            # so drop that leftover first and build it again.
            if _index_valid(name) is False:
                op.execute(f"DROP INDEX CONCURRENTLY IF EXISTS {name}")
            op.execute(create)
            if _index_valid(name) is not True:
                raise RuntimeError(
                    f"Index {name} is invalid after its build. Repair it with "
                    f"REINDEX INDEX CONCURRENTLY {name}, then rerun the migration."
                )

        for name, _ in _CONSTRAINTS:
            op.execute(f"ALTER TABLE secrets VALIDATE CONSTRAINT {name}")


def downgrade() -> None:
    deleted = op.get_bind().execute(text(_DELETE_ORGANIZATION_CONNECTIONS_SQL)).rowcount
    log.info("[secrets] deleted %s organization connections", deleted)

    with op.get_context().autocommit_block():
        for name, _ in reversed(_INDEXES):
            op.execute(f"DROP INDEX CONCURRENTLY IF EXISTS {name}")

    for name, _ in reversed(_CONSTRAINTS):
        op.execute(f"ALTER TABLE secrets DROP CONSTRAINT IF EXISTS {name}")
    op.execute("DROP TABLE IF EXISTS secret_projects")
    op.execute("ALTER TABLE secrets DROP COLUMN IF EXISTS availability")
