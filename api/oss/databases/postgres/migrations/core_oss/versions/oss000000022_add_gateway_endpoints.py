"""add gateway endpoints

Creates the two tables the gateways domain persists (entities.md §1, §3):
llms_endpoints and mcps_endpoints. Every row in both is a custom row by
construction — standard and builtin endpoints are generated, never stored (D20).

The MCP OAuth flow stores its token material in a project-owned `oauth_grant` secret, so this
unreleased gateway migration also extends the shared `secretkind_enum` before any endpoint can
reference that handle.

The two new Postgres enum types (llmdeploymentkind_enum, gatewayauthscheme_enum)
use the enum member NAMES (upper-case), matching this codebase's existing
SQLAlchemy-enum convention (see secretkind_enum) rather than the lower-case
DTO values.

secret_id is SET NULL on both tables: a dead secret must not silently delete an
endpoint's configuration (§2.1). Each endpoint names one secret, project-owned —
user-level grants are out of scope, and reopening them adds tables rather than
changing these (out-of-scope.md).

`llms_endpoints.provider_key` is nullable. A custom endpoint can point at a
self-hosted OpenAI-compatible gateway without claiming a provider family that
does not describe that upstream.

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
    # This revision has not shipped. Keep the gateway's OAuth secret kind with the endpoint
    # schema rather than creating a second migration that would be immediately folded back.
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
