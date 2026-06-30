"""add mounts table

A mount is a durable object-store location bound to a project (and optionally
a session). The backend (SeaweedFS dev / S3 platform) is resolved from env
vars, not stored per row. session_id is a bare varchar column — not a FK —
because sessions may be external (trace/span ids). slug is project-unique
(unique constraint); the object key is derived (project_id/mount_id), so data
holds no storage location (empty JSON).

Revision ID: oss000000006
Revises: oss000000005
Create Date: 2026-06-28 00:00:00.000000

"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


# revision identifiers, used by Alembic.
revision: str = "oss000000006"
down_revision: Union[str, None] = "oss000000005"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "mounts",
        sa.Column("project_id", sa.UUID(), nullable=False),
        sa.Column("id", sa.UUID(), nullable=False),
        sa.Column("slug", sa.String(), nullable=False),
        sa.Column("session_id", sa.String(), nullable=True),
        sa.Column("name", sa.String(), nullable=True),
        sa.Column("description", sa.String(), nullable=True),
        sa.Column("data", postgresql.JSON(astext_type=sa.Text()), nullable=True),
        sa.Column(
            "flags",
            postgresql.JSONB(none_as_null=True, astext_type=sa.Text()),
            nullable=True,
        ),
        sa.Column(
            "created_at",
            sa.TIMESTAMP(timezone=True),
            server_default=sa.text("CURRENT_TIMESTAMP"),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.TIMESTAMP(timezone=True),
            server_onupdate=sa.text("CURRENT_TIMESTAMP"),
            nullable=True,
        ),
        sa.Column("deleted_at", sa.TIMESTAMP(timezone=True), nullable=True),
        sa.Column("created_by_id", sa.UUID(), nullable=True),
        sa.Column("updated_by_id", sa.UUID(), nullable=True),
        sa.Column("deleted_by_id", sa.UUID(), nullable=True),
        sa.ForeignKeyConstraint(["project_id"], ["projects.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("project_id", "id"),
        sa.UniqueConstraint(
            "project_id",
            "slug",
            name="uq_mounts_project_id_slug",
        ),
    )

    op.create_index(
        "ix_mounts_project_id_created_at",
        "mounts",
        ["project_id", "created_at"],
        unique=False,
    )
    op.create_index(
        "ix_mounts_project_id_deleted_at",
        "mounts",
        ["project_id", "deleted_at"],
        unique=False,
    )
    op.create_index(
        "ix_mounts_project_id_session_id",
        "mounts",
        ["project_id", "session_id"],
        unique=False,
        postgresql_where=sa.text("session_id IS NOT NULL"),
    )


def downgrade() -> None:
    op.drop_index("ix_mounts_project_id_session_id", table_name="mounts")
    op.drop_index("ix_mounts_project_id_deleted_at", table_name="mounts")
    op.drop_index("ix_mounts_project_id_created_at", table_name="mounts")
    op.drop_table("mounts")
