"""add tool_connections table

Revision ID: e5f6a1b2c3d4
Revises: c2d3e4f5a6b7
Create Date: 2026-02-09 12:00:00.000000

"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


# revision identifiers, used by Alembic.
revision: str = "e5f6a1b2c3d4"
down_revision: Union[str, None] = "c2d3e4f5a6b7"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # -- TOOL CONNECTIONS -------------------------------------------------------
    # Note: SQLAlchemy will automatically create the enum type when creating the table
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
        sa.Column("tags", postgresql.JSONB(none_as_null=True), nullable=True),
        sa.Column("flags", postgresql.JSONB(none_as_null=True), nullable=True),
        sa.Column("data", postgresql.JSON(none_as_null=True), nullable=True),
        sa.Column("status", postgresql.JSONB(none_as_null=True), nullable=True),
        sa.Column("meta", postgresql.JSON(none_as_null=True), nullable=True),
        #
        sa.Column(
            "created_at",
            sa.TIMESTAMP(timezone=True),
            server_default=sa.text("CURRENT_TIMESTAMP"),
            nullable=False,
        ),
        sa.Column("updated_at", sa.TIMESTAMP(timezone=True), nullable=True),
        sa.Column("deleted_at", sa.TIMESTAMP(timezone=True), nullable=True),
        sa.Column("created_by_id", sa.UUID(), nullable=False),
        sa.Column("updated_by_id", sa.UUID(), nullable=True),
        sa.Column("deleted_by_id", sa.UUID(), nullable=True),
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
