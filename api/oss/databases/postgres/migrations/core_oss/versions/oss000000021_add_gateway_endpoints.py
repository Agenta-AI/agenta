"""add gateway endpoints and grants

Creates the three tables the gateways domain persists (entities.md §1, §3):
llm_gateway_endpoints, mcp_gateway_endpoints and mcp_gateway_grants. Every row in
all three is a custom row by construction — standard and builtin endpoints are
generated, never stored (D20).

The two new Postgres enum types (llmdeploymentkind_enum, gatewayauthscheme_enum)
use the enum member NAMES (upper-case), matching this codebase's existing
SQLAlchemy-enum convention (see secretkind_enum) rather than the lower-case
DTO values.

The secret_id FK behaviour is deliberately asymmetric: SET NULL on both endpoint
tables (a dead credential must not silently delete configuration, §2.1) and
CASCADE on grants (a grant row with no secret means nothing, §2.1). The two
partial unique indexes on mcp_gateway_grants state "one grant per owner per
server" under a nullable owner (§2.5) — a plain UNIQUE constraint cannot express
this because Postgres treats NULLs as distinct.

Revision ID: oss000000021
Revises: oss000000020
Create Date: 2026-08-13 00:00:00.000000

"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "oss000000021"
down_revision: Union[str, None] = "oss000000020"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "llm_gateway_endpoints",
        sa.Column("id", sa.UUID(as_uuid=True), nullable=False),
        sa.Column("project_id", sa.UUID(as_uuid=True), nullable=False),
        sa.Column("slug", sa.String(), nullable=False),
        sa.Column("name", sa.String(), nullable=True),
        sa.Column("description", sa.String(), nullable=True),
        sa.Column("provider_key", sa.String(), nullable=False),
        sa.Column(
            "deployment",
            sa.Enum(
                "DIRECT",
                "CUSTOM",
                "AZURE",
                "BEDROCK",
                "SAGEMAKER",
                "VERTEX",
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
            name="uq_llm_gateway_endpoints_project_slug",
        ),
    )
    op.create_index(
        "ix_llm_gateway_endpoints_project_provider",
        "llm_gateway_endpoints",
        ["project_id", "provider_key"],
    )
    op.create_index(
        "ix_llm_gateway_endpoints_flags",
        "llm_gateway_endpoints",
        ["flags"],
        postgresql_using="gin",
    )

    op.create_table(
        "mcp_gateway_endpoints",
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
            name="uq_mcp_gateway_endpoints_project_slug",
        ),
    )
    op.create_index(
        "ix_mcp_gateway_endpoints_flags",
        "mcp_gateway_endpoints",
        ["flags"],
        postgresql_using="gin",
    )

    op.create_table(
        "mcp_gateway_grants",
        sa.Column("id", sa.UUID(as_uuid=True), nullable=False),
        sa.Column("project_id", sa.UUID(as_uuid=True), nullable=False),
        sa.Column("endpoint_id", sa.UUID(as_uuid=True), nullable=False),
        sa.Column("user_id", sa.UUID(as_uuid=True), nullable=True),
        sa.Column("secret_id", sa.UUID(as_uuid=True), nullable=False),
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
            ondelete="CASCADE",
        ),
    )
    op.create_index(
        "uq_mcp_gateway_grants_user",
        "mcp_gateway_grants",
        ["project_id", "endpoint_id", "user_id"],
        unique=True,
        postgresql_where=sa.text("user_id IS NOT NULL"),
    )
    op.create_index(
        "uq_mcp_gateway_grants_project",
        "mcp_gateway_grants",
        ["project_id", "endpoint_id"],
        unique=True,
        postgresql_where=sa.text("user_id IS NULL"),
    )
    op.create_index(
        "ix_mcp_gateway_grants_endpoint",
        "mcp_gateway_grants",
        ["project_id", "endpoint_id"],
    )


def downgrade() -> None:
    op.drop_index("ix_mcp_gateway_grants_endpoint", table_name="mcp_gateway_grants")
    op.drop_index("uq_mcp_gateway_grants_project", table_name="mcp_gateway_grants")
    op.drop_index("uq_mcp_gateway_grants_user", table_name="mcp_gateway_grants")
    op.drop_table("mcp_gateway_grants")

    op.drop_index("ix_mcp_gateway_endpoints_flags", table_name="mcp_gateway_endpoints")
    op.drop_table("mcp_gateway_endpoints")

    op.drop_index("ix_llm_gateway_endpoints_flags", table_name="llm_gateway_endpoints")
    op.drop_index(
        "ix_llm_gateway_endpoints_project_provider",
        table_name="llm_gateway_endpoints",
    )
    op.drop_table("llm_gateway_endpoints")

    op.execute("DROP TYPE IF EXISTS gatewayauthscheme_enum")
    op.execute("DROP TYPE IF EXISTS llmdeploymentkind_enum")
