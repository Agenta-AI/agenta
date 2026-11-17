"""standardize lifecycle columns and align foreign keys with the FK policy

Every table gets the six lifecycle columns (created/updated/deleted x at/by_id),
all fully nullable, created_at with a server default. Lifecycle actor columns
carry no FKs (organizations' three and api_keys.created_by_id are dropped).
Owning-scope FKs are added where missing (webhook_deliveries, secrets) and
membership/invitation user FKs get explicit ON DELETE behavior. Per
docs/designs/oss-ee-convergence/db-integrity-audit.md.

Revision ID: 4f5a6b7c8d9e
Revises: 3d4e5f6a7b8c
Create Date: 2026-06-12 00:00:04.000000

"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision: str = "4f5a6b7c8d9e"
down_revision: Union[str, None] = "3d4e5f6a7b8c"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


LIFECYCLE_TIMESTAMPS = ("created_at", "updated_at", "deleted_at")
LIFECYCLE_ACTORS = ("created_by_id", "updated_by_id", "deleted_by_id")

# (table, columns to add) — brings every account table to the full six.
MISSING_COLUMNS = {
    "users": ("deleted_at", "created_by_id", "updated_by_id", "deleted_by_id"),
    "workspaces": ("deleted_at", "created_by_id", "updated_by_id", "deleted_by_id"),
    "projects": ("deleted_at", "created_by_id", "updated_by_id", "deleted_by_id"),
    "organization_members": ("deleted_at", "created_by_id", "deleted_by_id"),
    "workspace_members": ("deleted_at", "created_by_id", "deleted_by_id"),
    "project_members": ("deleted_at", "created_by_id", "deleted_by_id"),
    "project_invitations": (
        "updated_at",
        "deleted_at",
        "created_by_id",
        "updated_by_id",
        "deleted_by_id",
    ),
    "api_keys": ("deleted_at", "updated_by_id", "deleted_by_id"),
    "secrets": ("deleted_at", "created_by_id", "deleted_by_id"),
}

# Every table carrying lifecycle columns in the core database.
LIFECYCLE_TABLES = (
    "organizations",
    "users",
    "workspaces",
    "projects",
    "organization_members",
    "workspace_members",
    "project_members",
    "project_invitations",
    "api_keys",
    "secrets",
    "user_identities",
    "folders",
    "tool_connections",
    "webhook_subscriptions",
    "webhook_deliveries",
    "testcase_blobs",
    "workflow_artifacts",
    "workflow_variants",
    "workflow_revisions",
    "testset_artifacts",
    "testset_variants",
    "testset_revisions",
    "query_artifacts",
    "query_variants",
    "query_revisions",
    "environment_artifacts",
    "environment_variants",
    "environment_revisions",
    "evaluation_runs",
    "evaluation_scenarios",
    "evaluation_results",
    "evaluation_metrics",
    "evaluation_queues",
)

# Lifecycle actor FKs to drop (rule: *_by_id columns carry no FKs).
LIFECYCLE_FKS_TO_DROP = (
    ("organizations", "created_by_id"),
    ("organizations", "updated_by_id"),
    ("organizations", "deleted_by_id"),
    ("api_keys", "created_by_id"),
    ("webhook_subscriptions", "created_by_id"),
)


def _add_missing_columns() -> None:
    for table, columns in MISSING_COLUMNS.items():
        for column in columns:
            kind = (
                sa.UUID() if column.endswith("_by_id") else sa.TIMESTAMP(timezone=True)
            )
            op.add_column(table, sa.Column(column, kind, nullable=True))


def _relax_and_default() -> None:
    for table in LIFECYCLE_TABLES:
        for column in LIFECYCLE_TIMESTAMPS + LIFECYCLE_ACTORS:
            op.execute(f'ALTER TABLE "{table}" ALTER COLUMN "{column}" DROP NOT NULL')
        op.execute(
            f'ALTER TABLE "{table}" ALTER COLUMN "created_at"'
            " SET DEFAULT CURRENT_TIMESTAMP"
        )


def _drop_fks_on_column(table: str, column: str) -> None:
    # Constraint names vary across deployments; drop by introspection.
    op.execute(
        f"""
        DO $$
        DECLARE c text;
        BEGIN
            FOR c IN
                SELECT con.conname
                FROM pg_constraint con
                JOIN pg_class rel ON rel.oid = con.conrelid
                JOIN pg_attribute att
                    ON att.attrelid = rel.oid AND att.attnum = ANY(con.conkey)
                WHERE rel.relname = '{table}'
                  AND con.contype = 'f'
                  AND att.attname = '{column}'
            LOOP
                EXECUTE format('ALTER TABLE "{table}" DROP CONSTRAINT %I', c);
            END LOOP;
        END $$;
        """
    )


def upgrade() -> None:
    # -- LIFECYCLE COLUMNS -------------------------------------------------------
    _add_missing_columns()
    _relax_and_default()

    # -- LIFECYCLE ACTOR FKS (drop, per policy) ----------------------------------
    for table, column in LIFECYCLE_FKS_TO_DROP:
        _drop_fks_on_column(table, column)

    # -- MEMBERSHIP / INVITATION USER FKS (explicit ON DELETE) -------------------
    for table in ("organization_members", "workspace_members", "project_members"):
        _drop_fks_on_column(table, "user_id")
        op.create_foreign_key(
            f"{table}_user_id_fkey",
            table,
            "users",
            ["user_id"],
            ["id"],
            ondelete="CASCADE",
        )

    _drop_fks_on_column("project_invitations", "user_id")
    op.create_foreign_key(
        "project_invitations_user_id_fkey",
        "project_invitations",
        "users",
        ["user_id"],
        ["id"],
        ondelete="SET NULL",
    )

    # -- WEBHOOK DELIVERIES (owning-scope FKs; event_id stays loose: cross-DB) ---
    op.execute(
        """
        DELETE FROM webhook_deliveries d
        WHERE NOT EXISTS (SELECT 1 FROM projects p WHERE p.id = d.project_id)
           OR NOT EXISTS (
                SELECT 1 FROM webhook_subscriptions s
                WHERE s.project_id = d.project_id AND s.id = d.subscription_id
           )
        """
    )
    _drop_fks_on_column("webhook_deliveries", "project_id")
    _drop_fks_on_column("webhook_deliveries", "subscription_id")
    op.create_foreign_key(
        "webhook_deliveries_project_id_fkey",
        "webhook_deliveries",
        "projects",
        ["project_id"],
        ["id"],
        ondelete="CASCADE",
    )
    op.create_foreign_key(
        "webhook_deliveries_subscription_id_fkey",
        "webhook_deliveries",
        "webhook_subscriptions",
        ["project_id", "subscription_id"],
        ["project_id", "id"],
        ondelete="CASCADE",
    )

    # -- SECRETS (owning-scope FKs; dangling scopes nulled, rows kept) -----------
    op.execute(
        """
        UPDATE secrets SET project_id = NULL
        WHERE project_id IS NOT NULL
          AND NOT EXISTS (SELECT 1 FROM projects p WHERE p.id = secrets.project_id)
        """
    )
    op.execute(
        """
        UPDATE secrets SET organization_id = NULL
        WHERE organization_id IS NOT NULL
          AND NOT EXISTS (
                SELECT 1 FROM organizations o WHERE o.id = secrets.organization_id
          )
        """
    )
    _drop_fks_on_column("secrets", "project_id")
    _drop_fks_on_column("secrets", "organization_id")
    op.create_foreign_key(
        "secrets_project_id_fkey",
        "secrets",
        "projects",
        ["project_id"],
        ["id"],
        ondelete="CASCADE",
    )
    op.create_foreign_key(
        "secrets_organization_id_fkey",
        "secrets",
        "organizations",
        ["organization_id"],
        ["id"],
        ondelete="CASCADE",
    )


def downgrade() -> None:
    raise NotImplementedError(
        "Lifecycle/FK standardization is not reversible; restore from a backup."
    )
