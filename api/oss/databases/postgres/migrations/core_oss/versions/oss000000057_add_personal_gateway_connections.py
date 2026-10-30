"""add personal gateway connections: owner columns, a default flag, an id primary key

A person's own Composio connection is a `gateway_connections` row with `organization_id`
and `user_id` set and `project_id` NULL. This revision:

- adds `organization_id` and `user_id` (cascading FKs) and makes `project_id` nullable;
- adds `is_default` (false for every existing row): a person's default connection for an
  integration, which a "user" Composio tool uses when the person made no account choice;
- moves the primary key from `(project_id, id)` to `(id)` and keeps a unique
  `(project_id, id)` for the `trigger_subscriptions` FK (a subscription always names a
  project connection);
- `ck_gateway_connections_single_owner`: a project row, an organization row, or a
  person's row (organization and user);
- `ck_gateway_connections_default_user`: only a person's row can be a default;
- `uq_gateway_connections_user_provider_integration_slug` and
  `uq_gateway_connections_organization_provider_integration_slug`: the slug is unique per
  owner, provider and integration, as for a project;
- `uq_gateway_connections_user_default`: at most one default per person and integration;
- `ix_gateway_connections_user_account`: the OAuth callback's lookup of a person's row.

One-way door on the key. The unique indexes are built concurrently first; the key swap
and the FK re-point then run in one short transaction under a lock timeout. No row is
rewritten: every existing row is a project row.

The downgrade deletes the person and organization rows, then restores the composite key.

Revision ID: oss000000057
Revises: oss000000056
Create Date: 2026-10-29 00:00:00.000000
"""

from typing import Sequence, Union

from alembic import op
from sqlalchemy import text

revision: str = "oss000000057"
down_revision: Union[str, None] = "oss000000056"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

_INDEXES = (
    (
        "uq_gateway_connections_id",
        "CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS uq_gateway_connections_id "
        "ON gateway_connections (id)",
    ),
    (
        "uq_gateway_connections_project_id_id",
        "CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS "
        "uq_gateway_connections_project_id_id ON gateway_connections (project_id, id)",
    ),
    (
        "uq_gateway_connections_user_provider_integration_slug",
        "CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS "
        "uq_gateway_connections_user_provider_integration_slug ON gateway_connections "
        "(organization_id, user_id, provider_key, integration_key, slug) "
        "WHERE user_id IS NOT NULL",
    ),
    (
        "uq_gateway_connections_organization_provider_integration_slug",
        "CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS "
        "uq_gateway_connections_organization_provider_integration_slug "
        "ON gateway_connections (organization_id, provider_key, integration_key, slug) "
        "WHERE project_id IS NULL AND user_id IS NULL",
    ),
    (
        "uq_gateway_connections_user_default",
        "CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS "
        "uq_gateway_connections_user_default ON gateway_connections "
        "(organization_id, user_id, provider_key, integration_key) "
        "WHERE is_default AND user_id IS NOT NULL",
    ),
    (
        "ix_gateway_connections_user_account",
        "CREATE INDEX CONCURRENTLY IF NOT EXISTS ix_gateway_connections_user_account "
        "ON gateway_connections (organization_id, user_id, "
        "(data ->> 'connected_account_id')) WHERE user_id IS NOT NULL",
    ),
)

_SINGLE_OWNER_CHECK = (
    "CHECK ((project_id IS NOT NULL AND organization_id IS NULL AND user_id IS NULL) "
    "OR (project_id IS NULL AND organization_id IS NOT NULL))"
)

_DEFAULT_USER_CHECK = "CHECK (NOT is_default OR user_id IS NOT NULL)"

_PRIMARY_KEY_SQL = (
    "SELECT conname, pg_catalog.pg_get_constraintdef(oid) FROM pg_catalog.pg_constraint "
    "WHERE conrelid = pg_catalog.to_regclass('gateway_connections') AND contype = 'p'"
)

_SUBSCRIPTION_FKS_SQL = (
    "SELECT conname FROM pg_catalog.pg_constraint "
    "WHERE conrelid = pg_catalog.to_regclass('trigger_subscriptions') AND contype = 'f' "
    "AND confrelid = pg_catalog.to_regclass('gateway_connections')"
)

_CONSTRAINT_EXISTS_SQL = (
    "SELECT 1 FROM pg_catalog.pg_constraint "
    "WHERE conname = :name AND conrelid = pg_catalog.to_regclass(:table)"
)

_INDEX_VALID_SQL = (
    "SELECT indisvalid FROM pg_catalog.pg_index "
    "WHERE indexrelid = pg_catalog.to_regclass(:name)"
)

_SUBSCRIPTION_FK = "fk_trigger_subscriptions_connection"


def _scalar(sql: str, **params):
    return op.get_bind().execute(text(sql), params).scalar()


def _exists(name: str, table: str) -> bool:
    return _scalar(_CONSTRAINT_EXISTS_SQL, name=name, table=table) is not None


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
        "ALTER TABLE gateway_connections "
        "ADD COLUMN IF NOT EXISTS organization_id UUID, "
        "ADD COLUMN IF NOT EXISTS user_id UUID, "
        "ADD COLUMN IF NOT EXISTS is_default BOOLEAN NOT NULL DEFAULT false"
    )
    for name, definition in (
        (
            "fk_gateway_connections_organization_id",
            "FOREIGN KEY (organization_id) REFERENCES organizations (id) "
            "ON DELETE CASCADE",
        ),
        (
            "fk_gateway_connections_user_id",
            "FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE",
        ),
        ("ck_gateway_connections_single_owner", _SINGLE_OWNER_CHECK),
        ("ck_gateway_connections_default_user", _DEFAULT_USER_CHECK),
    ):
        if not _exists(name, "gateway_connections"):
            op.execute(
                f"ALTER TABLE gateway_connections ADD CONSTRAINT {name} "
                f"{definition} NOT VALID"
            )

    with op.get_context().autocommit_block():
        for name, create in _INDEXES:
            _build(name, create)

    # The key swap: one short transaction. The subscription FK depends on the old key's
    # index, so it is dropped and re-added against the (project_id, id) constraint.
    op.execute("SET LOCAL lock_timeout = '5s'")
    primary = op.get_bind().execute(text(_PRIMARY_KEY_SQL)).first()
    if primary is not None and "project_id" in primary[1]:
        for (fk_name,) in op.get_bind().execute(text(_SUBSCRIPTION_FKS_SQL)).all():
            op.execute(f"ALTER TABLE trigger_subscriptions DROP CONSTRAINT {fk_name}")
        op.execute(f"ALTER TABLE gateway_connections DROP CONSTRAINT {primary[0]}")
    if not _exists("pk_gateway_connections", "gateway_connections"):
        op.execute(
            "ALTER TABLE gateway_connections ADD CONSTRAINT pk_gateway_connections "
            "PRIMARY KEY USING INDEX uq_gateway_connections_id"
        )
    if not _exists("uq_gateway_connections_project_id_id", "gateway_connections"):
        op.execute(
            "ALTER TABLE gateway_connections ADD CONSTRAINT "
            "uq_gateway_connections_project_id_id UNIQUE USING INDEX "
            "uq_gateway_connections_project_id_id"
        )
    op.execute("ALTER TABLE gateway_connections ALTER COLUMN project_id DROP NOT NULL")
    if (
        not _exists(_SUBSCRIPTION_FK, "trigger_subscriptions")
        and not op.get_bind().execute(text(_SUBSCRIPTION_FKS_SQL)).first()
    ):
        op.execute(
            f"ALTER TABLE trigger_subscriptions ADD CONSTRAINT {_SUBSCRIPTION_FK} "
            "FOREIGN KEY (project_id, connection_id) "
            "REFERENCES gateway_connections (project_id, id) ON DELETE CASCADE NOT VALID"
        )

    with op.get_context().autocommit_block():
        for name, table in (
            ("fk_gateway_connections_organization_id", "gateway_connections"),
            ("fk_gateway_connections_user_id", "gateway_connections"),
            ("ck_gateway_connections_single_owner", "gateway_connections"),
            ("ck_gateway_connections_default_user", "gateway_connections"),
            (_SUBSCRIPTION_FK, "trigger_subscriptions"),
        ):
            if _exists(name, table):
                op.execute(f"ALTER TABLE {table} VALIDATE CONSTRAINT {name}")


def downgrade() -> None:
    op.execute("SET LOCAL lock_timeout = '5s'")
    op.execute("DELETE FROM gateway_connections WHERE project_id IS NULL")
    op.execute(
        f"ALTER TABLE trigger_subscriptions DROP CONSTRAINT IF EXISTS {_SUBSCRIPTION_FK}"
    )
    op.execute(
        "ALTER TABLE gateway_connections DROP CONSTRAINT IF EXISTS pk_gateway_connections"
    )
    op.execute(
        "ALTER TABLE gateway_connections DROP CONSTRAINT IF EXISTS "
        "uq_gateway_connections_project_id_id"
    )
    op.execute("ALTER TABLE gateway_connections ALTER COLUMN project_id SET NOT NULL")
    op.execute(
        "ALTER TABLE gateway_connections ADD CONSTRAINT gateway_connections_pkey "
        "PRIMARY KEY (project_id, id)"
    )
    op.execute(
        f"ALTER TABLE trigger_subscriptions ADD CONSTRAINT {_SUBSCRIPTION_FK} "
        "FOREIGN KEY (project_id, connection_id) "
        "REFERENCES gateway_connections (project_id, id) ON DELETE CASCADE"
    )
    for name in (
        "ck_gateway_connections_default_user",
        "ck_gateway_connections_single_owner",
        "fk_gateway_connections_user_id",
        "fk_gateway_connections_organization_id",
    ):
        op.execute(f"ALTER TABLE gateway_connections DROP CONSTRAINT IF EXISTS {name}")
    for name in (
        "ix_gateway_connections_user_account",
        "uq_gateway_connections_user_default",
        "uq_gateway_connections_organization_provider_integration_slug",
        "uq_gateway_connections_user_provider_integration_slug",
    ):
        op.execute(f"DROP INDEX IF EXISTS {name}")
    op.execute(
        "ALTER TABLE gateway_connections DROP COLUMN IF EXISTS is_default, "
        "DROP COLUMN IF EXISTS user_id, DROP COLUMN IF EXISTS organization_id"
    )
