"""add folders table and folder reference on applications

Revision ID: 7a3d1c4f5b6a
Revises: 79f40f71e912
Create Date: 2025-10-26 17:30:00.000000+00:00

"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql
from sqlalchemy_utils import LtreeType

from oss.src.core.folders.types import FolderKind

# revision identifiers, used by Alembic.
revision: str = "7a3d1c4f5b6a"
down_revision: Union[str, None] = "79f40f71e912"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute("CREATE EXTENSION IF NOT EXISTS ltree")

    op.create_table(
        "folders",
        sa.Column(
            "project_id",
            sa.UUID(),
            nullable=False,
        ),
        sa.Column(
            "id",
            sa.UUID(),
            nullable=False,
        ),
        sa.Column(
            "name",
            sa.String(),
            nullable=True,
        ),
        sa.Column(
            "description",
            sa.String(),
            nullable=True,
        ),
        sa.Column("slug", sa.String(), nullable=False),
        sa.Column(
            "created_at",
            sa.TIMESTAMP(timezone=True),
            server_default=sa.text("CURRENT_TIMESTAMP"),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.TIMESTAMP(timezone=True),
            nullable=True,
        ),
        sa.Column(
            "deleted_at",
            sa.TIMESTAMP(timezone=True),
            nullable=True,
        ),
        sa.Column(
            "created_by_id",
            sa.UUID(),
            nullable=False,
        ),
        sa.Column(
            "updated_by_id",
            sa.UUID(),
            nullable=True,
        ),
        sa.Column(
            "deleted_by_id",
            sa.UUID(),
            nullable=True,
        ),
        sa.Column(
            "tags",
            postgresql.JSONB(none_as_null=True, astext_type=sa.Text()),
            nullable=True,
        ),
        sa.Column(
            "flags",
            postgresql.JSONB(none_as_null=True, astext_type=sa.Text()),
            nullable=True,
        ),
        sa.Column(
            "meta",
            postgresql.JSON(none_as_null=True),
            nullable=True,
        ),
        sa.Column(
            "kind",
            sa.Enum(FolderKind, name="folder_kind_enum"),
            nullable=True,
        ),
        sa.Column(
            "path",
            LtreeType(),
            nullable=False,
        ),
        sa.Column(
            "parent_id",
            sa.UUID(),
            nullable=True,
        ),
        sa.PrimaryKeyConstraint(
            "project_id",
            "id",
        ),
        sa.ForeignKeyConstraint(
            ["project_id"],
            ["projects.id"],
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["project_id", "parent_id"],
            ["folders.project_id", "folders.id"],
            ondelete="CASCADE",
        ),
        sa.UniqueConstraint(
            "id",
            name="uq_folders_id",
        ),
        sa.UniqueConstraint(
            "project_id",
            "path",
            name="uq_folders_project_path",
        ),
        sa.UniqueConstraint(
            "project_id",
            "parent_id",
            "slug",
            name="uq_folders_project_parent_slug",
        ),
        sa.Index(
            "ix_folders_project_kind",
            "project_id",
            "kind",
            postgresql_using="btree",
        ),
        sa.Index(
            "ix_folders_project_path",
            "project_id",
            "path",
            postgresql_using="btree",
        ),
    )

    op.add_column(
        "app_db",
        sa.Column("folder_id", sa.UUID(), nullable=True),
    )
    op.create_foreign_key(
        "fk_app_db_folder_id_folders",
        "app_db",
        "folders",
        ["folder_id"],
        ["id"],
        ondelete="SET NULL",
    )


def downgrade() -> None:
    op.drop_constraint("fk_app_db_folder_id_folders", "app_db", type_="foreignkey")
    op.drop_column("app_db", "folder_id")

    op.drop_index("ix_folders_project_path", table_name="folders")
    op.drop_index("ix_folders_project_kind", table_name="folders")
    op.drop_constraint("uq_folders_id", "folders", type_="unique")
    op.drop_constraint("uq_folders_project_parent_slug", "folders", type_="unique")
    op.drop_constraint("uq_folders_project_path", "folders", type_="unique")
    op.drop_table("folders")

    op.execute("DROP TYPE IF EXISTS folder_kind_enum")
