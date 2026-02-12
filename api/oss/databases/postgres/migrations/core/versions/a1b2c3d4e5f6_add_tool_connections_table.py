"""add tool_connections table

Revision ID: a1b2c3d4e5f6
Revises: fd77265d65dc
Create Date: 2026-02-09 12:00:00.000000

"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = "a1b2c3d4e5f6"
down_revision: Union[str, None] = "c9d0e1f2a3b4"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # -- TOOL CONNECTIONS -------------------------------------------------------
    op.create_table(
        "tool_connections",
        sa.Column("project_id", sa.UUID(), nullable=False),
        sa.Column("id", sa.UUID(), nullable=False),
        sa.Column("slug", sa.String(), nullable=False),
        sa.Column("name", sa.String(), nullable=True),
        sa.Column("description", sa.String(), nullable=True),
        #
        sa.Column("provider_key", sa.String(), nullable=False),
        sa.Column("integration_key", sa.String(), nullable=False),
        #
        sa.Column("provider_connection_id", sa.String(), nullable=True),
        sa.Column("auth_config_id", sa.String(), nullable=True),
        #
        sa.Column(
            "is_active", sa.Boolean(), nullable=False, server_default=sa.text("true")
        ),
        sa.Column(
            "is_valid", sa.Boolean(), nullable=False, server_default=sa.text("false")
        ),
        sa.Column("status", sa.String(), nullable=True),
        #
        sa.Column(
            "created_at",
            sa.TIMESTAMP(timezone=True),
            server_default=sa.text("CURRENT_TIMESTAMP"),
            nullable=False,
        ),
        sa.Column("updated_at", sa.TIMESTAMP(timezone=True), nullable=True),
        sa.Column("created_by_id", sa.UUID(), nullable=False),
        #
        sa.PrimaryKeyConstraint("project_id", "id"),
        sa.UniqueConstraint(
            "project_id",
            "provider_key",
            "integration_key",
            "slug",
            name="uq_tool_connections_project_provider_integration_slug",
        ),
        sa.ForeignKeyConstraint(
            ["project_id"],
            ["projects.id"],
            ondelete="CASCADE",
        ),
        sa.Index(
            "ix_tool_connections_project_provider_integration",
            "project_id",
            "provider_key",
            "integration_key",
        ),
    )


def downgrade() -> None:
    op.drop_table("tool_connections")
