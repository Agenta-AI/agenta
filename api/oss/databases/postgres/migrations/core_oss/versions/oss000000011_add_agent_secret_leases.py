"""add durable agent secret leases

Revision ID: oss000000011
Revises: oss000000010
Create Date: 2026-07-11 00:00:00.000000
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "oss000000011"
down_revision: Union[str, None] = "oss000000010"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "agent_secret_leases",
        sa.Column("id", sa.UUID(as_uuid=True), nullable=False),
        sa.Column("organization_id", sa.UUID(as_uuid=True), nullable=False),
        sa.Column("workspace_id", sa.UUID(as_uuid=True), nullable=False),
        sa.Column("project_id", sa.UUID(as_uuid=True), nullable=False),
        sa.Column("created_by_id", sa.UUID(as_uuid=True), nullable=False),
        sa.Column("provider", sa.String(), nullable=False),
        sa.Column("owner_kind", sa.String(), nullable=False),
        sa.Column("owner_id", sa.String(), nullable=False),
        sa.Column("idempotency_key", sa.String(), nullable=False),
        sa.Column("plan_digest", sa.String(), nullable=False),
        sa.Column("credential_epoch_digest", sa.String(), nullable=False),
        sa.Column("sandbox_id", sa.String(), nullable=True),
        sa.Column("sandbox_fingerprint", sa.String(), nullable=True),
        sa.Column("sandbox_label", sa.String(), nullable=False),
        sa.Column("state", sa.String(), nullable=False),
        sa.Column("version", sa.Integer(), server_default="1", nullable=False),
        sa.Column("attempt_count", sa.Integer(), server_default="0", nullable=False),
        sa.Column("next_attempt_at", sa.TIMESTAMP(timezone=True), nullable=True),
        sa.Column("last_error_code", sa.String(), nullable=True),
        sa.Column("last_error_at", sa.TIMESTAMP(timezone=True), nullable=True),
        sa.Column("claim_id", sa.UUID(as_uuid=True), nullable=True),
        sa.Column("claim_owner", sa.String(), nullable=True),
        sa.Column("claim_expires_at", sa.TIMESTAMP(timezone=True), nullable=True),
        sa.Column("claim_generation", sa.Integer(), server_default="0", nullable=False),
        sa.Column("activated_at", sa.TIMESTAMP(timezone=True), nullable=True),
        sa.Column("cleanup_requested_at", sa.TIMESTAMP(timezone=True), nullable=True),
        sa.Column(
            "created_at",
            sa.TIMESTAMP(timezone=True),
            server_default=sa.text("CURRENT_TIMESTAMP"),
            nullable=False,
        ),
        sa.Column("updated_at", sa.TIMESTAMP(timezone=True), nullable=True),
        sa.Column("deleted_at", sa.TIMESTAMP(timezone=True), nullable=True),
        sa.CheckConstraint(
            "provider = 'daytona'", name="ck_agent_secret_leases_provider"
        ),
        sa.CheckConstraint(
            "owner_kind IN ('session','run')", name="ck_agent_secret_leases_owner_kind"
        ),
        sa.CheckConstraint(
            "state IN ('reserved','provisioning','active','cleanup_pending','cleaning','deleted','quarantined')",
            name="ck_agent_secret_leases_state",
        ),
        sa.CheckConstraint(
            "version >= 1 AND attempt_count >= 0 AND claim_generation >= 0",
            name="ck_agent_secret_leases_counters",
        ),
        sa.ForeignKeyConstraint(["organization_id"], ["organizations.id"]),
        sa.ForeignKeyConstraint(["workspace_id"], ["workspaces.id"]),
        sa.ForeignKeyConstraint(["project_id"], ["projects.id"]),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint(
            "id",
            "organization_id",
            "workspace_id",
            "project_id",
            name="uq_agent_secret_leases_scope",
        ),
        sa.UniqueConstraint(
            "organization_id",
            "project_id",
            "idempotency_key",
            name="uq_agent_secret_leases_idempotency",
        ),
        sa.UniqueConstraint(
            "sandbox_label", name="uq_agent_secret_leases_sandbox_label"
        ),
    )
    op.create_index(
        "ix_agent_secret_leases_provider_retry",
        "agent_secret_leases",
        ["provider", "state", "next_attempt_at", "id"],
    )
    op.create_index(
        "ix_agent_secret_leases_org_retry",
        "agent_secret_leases",
        ["organization_id", "state", "next_attempt_at", "id"],
    )
    op.create_index(
        "ix_agent_secret_leases_owner",
        "agent_secret_leases",
        ["project_id", "owner_kind", "owner_id"],
    )
    op.create_index(
        "uq_agent_secret_leases_provider_sandbox",
        "agent_secret_leases",
        ["provider", "sandbox_id"],
        unique=True,
        postgresql_where=sa.text("sandbox_id IS NOT NULL"),
    )

    op.create_table(
        "agent_secret_lease_resources",
        sa.Column("id", sa.UUID(as_uuid=True), nullable=False),
        sa.Column("lease_id", sa.UUID(as_uuid=True), nullable=False),
        sa.Column("organization_id", sa.UUID(as_uuid=True), nullable=False),
        sa.Column("workspace_id", sa.UUID(as_uuid=True), nullable=False),
        sa.Column("project_id", sa.UUID(as_uuid=True), nullable=False),
        sa.Column("provider", sa.String(), nullable=False),
        sa.Column("ordinal", sa.Integer(), nullable=False),
        sa.Column("consumer_kind", sa.String(), nullable=False),
        sa.Column("consumer_key", sa.String(), nullable=True),
        sa.Column("binding_kind", sa.String(), nullable=False),
        sa.Column("binding_name", sa.String(), nullable=False),
        sa.Column("usage", sa.String(), nullable=False),
        sa.Column("allowed_host", sa.String(), nullable=False),
        sa.Column("provider_secret_name", sa.String(), nullable=False),
        sa.Column("provider_secret_id", sa.String(), nullable=True),
        sa.Column("state", sa.String(), nullable=False),
        sa.Column("version", sa.Integer(), server_default="1", nullable=False),
        sa.Column(
            "created_at",
            sa.TIMESTAMP(timezone=True),
            server_default=sa.text("CURRENT_TIMESTAMP"),
            nullable=False,
        ),
        sa.Column("updated_at", sa.TIMESTAMP(timezone=True), nullable=True),
        sa.Column("deleted_at", sa.TIMESTAMP(timezone=True), nullable=True),
        sa.CheckConstraint(
            "consumer_kind IN ('model','http_mcp')",
            name="ck_agent_secret_lease_resources_consumer_kind",
        ),
        sa.CheckConstraint(
            "binding_kind IN ('environment','header')",
            name="ck_agent_secret_lease_resources_binding_kind",
        ),
        sa.CheckConstraint(
            "usage = 'opaque_http'", name="ck_agent_secret_lease_resources_usage"
        ),
        sa.CheckConstraint(
            "state IN ('planned','created','deleted')",
            name="ck_agent_secret_lease_resources_state",
        ),
        sa.CheckConstraint(
            "version >= 1 AND ordinal >= 0",
            name="ck_agent_secret_lease_resources_counters",
        ),
        sa.ForeignKeyConstraint(
            ["lease_id", "organization_id", "workspace_id", "project_id"],
            [
                "agent_secret_leases.id",
                "agent_secret_leases.organization_id",
                "agent_secret_leases.workspace_id",
                "agent_secret_leases.project_id",
            ],
            ondelete="RESTRICT",
            name="fk_agent_secret_lease_resources_parent_scope",
        ),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint(
            "lease_id", "ordinal", name="uq_agent_secret_lease_resources_ordinal"
        ),
        sa.UniqueConstraint(
            "provider",
            "provider_secret_name",
            name="uq_agent_secret_lease_resources_provider_name",
        ),
    )
    op.create_index(
        "ix_agent_secret_lease_resources_lease",
        "agent_secret_lease_resources",
        ["lease_id", "ordinal"],
    )
    op.execute(
        "CREATE UNIQUE INDEX uq_agent_secret_lease_resources_binding ON agent_secret_lease_resources (lease_id, binding_kind, binding_name, consumer_kind, COALESCE(consumer_key, ''))"
    )


def downgrade() -> None:
    op.drop_index(
        "uq_agent_secret_lease_resources_binding",
        table_name="agent_secret_lease_resources",
    )
    op.drop_index(
        "ix_agent_secret_lease_resources_lease",
        table_name="agent_secret_lease_resources",
    )
    op.drop_table("agent_secret_lease_resources")
    op.drop_index(
        "uq_agent_secret_leases_provider_sandbox", table_name="agent_secret_leases"
    )
    op.drop_index("ix_agent_secret_leases_owner", table_name="agent_secret_leases")
    op.drop_index("ix_agent_secret_leases_org_retry", table_name="agent_secret_leases")
    op.drop_index(
        "ix_agent_secret_leases_provider_retry", table_name="agent_secret_leases"
    )
    op.drop_table("agent_secret_leases")
