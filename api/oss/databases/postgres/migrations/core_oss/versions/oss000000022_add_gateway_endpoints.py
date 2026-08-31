"""Add persisted custom LLM and MCP gateway endpoints.

Standard and built-in endpoints are generated at read time. OAuth grants are project-owned
secrets. Endpoint secrets use SET NULL so secret deletion preserves endpoint configuration.
Custom LLM endpoints may omit a provider key for self-hosted compatible servers.

Revision ID: oss000000022
Revises: oss000000020
Create Date: 2026-08-13 00:00:00.000000

"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "oss000000022"
down_revision: Union[str, None] = "oss000000021"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # OAuth grants are required by MCP endpoint OAuth connections.
    op.execute("ALTER TYPE secretkind_enum ADD VALUE IF NOT EXISTS 'OAUTH_GRANT'")

    op.create_table(
        "llms_endpoints",
        sa.Column("id", sa.UUID(as_uuid=True), nullable=False),
        sa.Column("project_id", sa.UUID(as_uuid=True), nullable=False),
        sa.Column("slug", sa.String(), nullable=False),
        sa.Column("name", sa.String(), nullable=True),
        sa.Column("description", sa.String(), nullable=True),
        sa.Column("provider_key", sa.String(), nullable=True),
        sa.Column(
            "deployment_kind",
            sa.Enum(
                "DIRECT",
                "CUSTOM",
                "AZURE",
                "BEDROCK",
                "SAGEMAKER",
                "VERTEX",
                "MOCK",
                name="llmdeploymentkind_enum",
            ),
            nullable=False,
        ),
        sa.Column("secret_id", sa.UUID(as_uuid=True), nullable=True),
        sa.Column("data", postgresql.JSON(none_as_null=True), nullable=True),
        sa.Column("status", postgresql.JSONB(none_as_null=True), nullable=True),
        sa.Column("flags", postgresql.JSONB(none_as_null=True), nullable=True),
        sa.Column("tags", postgresql.JSONB(none_as_null=True), nullable=True),
        sa.Column("meta", postgresql.JSON(none_as_null=True), nullable=True),
        sa.Column(
            "created_at",
            sa.TIMESTAMP(timezone=True),
            server_default=sa.func.current_timestamp(),
            nullable=True,
        ),
        sa.Column("updated_at", sa.TIMESTAMP(timezone=True), nullable=True),
        sa.Column("deleted_at", sa.TIMESTAMP(timezone=True), nullable=True),
        sa.Column("created_by_id", sa.UUID(as_uuid=True), nullable=True),
        sa.Column("updated_by_id", sa.UUID(as_uuid=True), nullable=True),
        sa.Column("deleted_by_id", sa.UUID(as_uuid=True), nullable=True),
        sa.PrimaryKeyConstraint("project_id", "id"),
        sa.ForeignKeyConstraint(
            ["project_id"],
            ["projects.id"],
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["secret_id"],
            ["secrets.id"],
            ondelete="SET NULL",
        ),
        sa.UniqueConstraint(
            "project_id",
            "slug",
            name="uq_llms_endpoints_project_slug",
        ),
    )
    op.create_index(
        "ix_llms_endpoints_project_provider",
        "llms_endpoints",
        ["project_id", "provider_key"],
    )
    op.create_index(
        "ix_llms_endpoints_flags",
        "llms_endpoints",
        ["flags"],
        postgresql_using="gin",
    )

    op.create_table(
        "mcps_endpoints",
        sa.Column("id", sa.UUID(as_uuid=True), nullable=False),
        sa.Column("project_id", sa.UUID(as_uuid=True), nullable=False),
        sa.Column("slug", sa.String(), nullable=False),
        sa.Column("name", sa.String(), nullable=True),
        sa.Column("description", sa.String(), nullable=True),
        sa.Column(
            "auth_mode",
            sa.Enum(
                "OAUTH",
                "API_KEY",
                "NONE",
                name="gatewayauthscheme_enum",
            ),
            nullable=False,
        ),
        sa.Column("secret_id", sa.UUID(as_uuid=True), nullable=True),
        sa.Column("data", postgresql.JSON(none_as_null=True), nullable=True),
        sa.Column("status", postgresql.JSONB(none_as_null=True), nullable=True),
        sa.Column("flags", postgresql.JSONB(none_as_null=True), nullable=True),
        sa.Column("tags", postgresql.JSONB(none_as_null=True), nullable=True),
        sa.Column("meta", postgresql.JSON(none_as_null=True), nullable=True),
        sa.Column(
            "created_at",
            sa.TIMESTAMP(timezone=True),
            server_default=sa.func.current_timestamp(),
            nullable=True,
        ),
        sa.Column("updated_at", sa.TIMESTAMP(timezone=True), nullable=True),
        sa.Column("deleted_at", sa.TIMESTAMP(timezone=True), nullable=True),
        sa.Column("created_by_id", sa.UUID(as_uuid=True), nullable=True),
        sa.Column("updated_by_id", sa.UUID(as_uuid=True), nullable=True),
        sa.Column("deleted_by_id", sa.UUID(as_uuid=True), nullable=True),
        sa.PrimaryKeyConstraint("project_id", "id"),
        sa.ForeignKeyConstraint(
            ["project_id"],
            ["projects.id"],
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["secret_id"],
            ["secrets.id"],
            ondelete="SET NULL",
        ),
        sa.UniqueConstraint(
            "project_id",
            "slug",
            name="uq_mcps_endpoints_project_slug",
        ),
    )
    op.create_index(
        "ix_mcps_endpoints_flags",
        "mcps_endpoints",
        ["flags"],
        postgresql_using="gin",
    )


def downgrade() -> None:

    op.drop_index("ix_mcps_endpoints_flags", table_name="mcps_endpoints")
    op.drop_table("mcps_endpoints")

    op.drop_index("ix_llms_endpoints_flags", table_name="llms_endpoints")
    op.drop_index(
        "ix_llms_endpoints_project_provider",
        table_name="llms_endpoints",
    )
    op.drop_table("llms_endpoints")

    op.execute("DROP TYPE IF EXISTS gatewayauthscheme_enum")
    op.execute("DROP TYPE IF EXISTS llmdeploymentkind_enum")
