"""add folders table and folder reference on applications

Revision ID: 7a3d1c4f5b6a
Revises: baa02d66a365
Create Date: 2025-10-26 17:30:00.000000+00:00

"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql
from sqlalchemy_utils import LtreeType

# revision identifiers, used by Alembic.
revision: str = "7a3d1c4f5b6a"
down_revision: Union[str, None] = "baa02d66a365"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


folder_kind_enum = sa.Enum("applications", name="folder_kind_enum")


def upgrade() -> None:
    op.execute("CREATE EXTENSION IF NOT EXISTS ltree")
    folder_kind_enum.create(op.get_bind(), checkfirst=True)

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
            folder_kind_enum,
            nullable=False,
            server_default="applications",
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
            ["parent_id"],
            ["folders.id"],
            ondelete="CASCADE",
        ),
        sa.UniqueConstraint(
            "project_id",
            "parent_id",
            "slug",
            name="uq_folders_project_parent_slug",
        ),
        sa.Index(
            "ix_folders_project_kind_path",
            "project_id",
            "kind",
            "path",
            postgresql_using="gist",
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

    op.drop_index("ix_folders_project_kind_path", table_name="folders")
    op.drop_constraint("uq_folders_project_parent_slug", "folders", type_="unique")
    op.drop_table("folders")

    folder_kind_enum.drop(op.get_bind(), checkfirst=True)
