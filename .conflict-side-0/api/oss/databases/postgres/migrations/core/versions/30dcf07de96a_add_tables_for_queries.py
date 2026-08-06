"""add tables for queries (artifacts, variants, & revisions)

Revision ID: 30dcf07de96a
Revises: 37e1d1e8b181
Create Date: 2025-07-30 14:55:00.000000

"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision: str = "30dcf07de96a"
down_revision: Union[str, None] = "37e1d1e8b181"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # - ARTIFACTS --------------------------------------------------------------

    op.create_table(
        "query_artifacts",
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
            "slug",
            sa.String(),
            nullable=False,
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
            "flags",
            postgresql.JSONB(none_as_null=True, astext_type=sa.Text()),
            nullable=True,
        ),
        sa.Column(
            "tags",
            postgresql.JSONB(none_as_null=True, astext_type=sa.Text()),
            nullable=True,
        ),
        sa.Column(
            "meta",
            postgresql.JSONB(none_as_null=True, astext_type=sa.Text()),
            nullable=True,
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
        sa.PrimaryKeyConstraint(
            "project_id",
            "id",
        ),
        sa.UniqueConstraint(
            "project_id",
            "slug",
        ),
        sa.ForeignKeyConstraint(
            ["project_id"],
            ["projects.id"],
            ondelete="CASCADE",
        ),
        sa.Index(
            "ix_query_artifacts_project_id_slug",
            "project_id",
            "slug",
        ),
    )

    # --------------------------------------------------------------------------

    # - VARIANTS ---------------------------------------------------------------

    op.create_table(
        "query_variants",
        sa.Column(
            "project_id",
            sa.UUID(),
            nullable=False,
        ),
        sa.Column(
            "artifact_id",
            sa.UUID(),
            nullable=False,
        ),
        sa.Column(
            "id",
            sa.UUID(),
            nullable=False,
        ),
        sa.Column(
            "slug",
            sa.String(),
            nullable=False,
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
            "flags",
            postgresql.JSONB(none_as_null=True, astext_type=sa.Text()),
            nullable=True,
        ),
        sa.Column(
            "tags",
            postgresql.JSONB(none_as_null=True, astext_type=sa.Text()),
            nullable=True,
        ),
        sa.Column(
            "meta",
            postgresql.JSONB(none_as_null=True, astext_type=sa.Text()),
            nullable=True,
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
        sa.PrimaryKeyConstraint(
            "project_id",
            "id",
        ),
        sa.UniqueConstraint(
            "project_id",
            "slug",
        ),
        sa.ForeignKeyConstraint(
            ["project_id"],
            ["projects.id"],
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["project_id", "artifact_id"],
            ["query_artifacts.project_id", "query_artifacts.id"],
            ondelete="CASCADE",
        ),
        sa.Index(
            "ix_query_variants_project_id_slug",
            "project_id",
            "slug",
        ),
        sa.Index(
            "ix_query_variants_project_id_artifact_id",
            "project_id",
            "artifact_id",
        ),
    )

    # --------------------------------------------------------------------------

    # - REVISIONS --------------------------------------------------------------

    op.create_table(
        "query_revisions",
        sa.Column(
            "project_id",
            sa.UUID(),
            nullable=False,
        ),
        sa.Column(
            "artifact_id",
            sa.UUID(),
            nullable=False,
        ),
        sa.Column(
            "variant_id",
            sa.UUID(),
            nullable=False,
        ),
        sa.Column(
            "id",
            sa.UUID(),
            nullable=False,
        ),
        sa.Column(
            "slug",
            sa.String(),
            nullable=False,
        ),
        sa.Column(
            "version",
            sa.String(),
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
            "flags",
            postgresql.JSONB(none_as_null=True, astext_type=sa.Text()),
            nullable=True,
        ),
        sa.Column(
            "tags",
            postgresql.JSONB(none_as_null=True, astext_type=sa.Text()),
            nullable=True,
        ),
        sa.Column(
            "meta",
            postgresql.JSONB(none_as_null=True, astext_type=sa.Text()),
            nullable=True,
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
        sa.Column(
            "message",
            sa.String(),
            nullable=True,
        ),
        sa.Column(
            "author",
            sa.UUID(),
            nullable=False,
        ),
        sa.Column(
            "date",
            sa.TIMESTAMP(timezone=True),
            server_default=sa.text("CURRENT_TIMESTAMP"),
            nullable=False,
        ),
        sa.Column(
            "data",
            postgresql.JSONB(none_as_null=True, astext_type=sa.Text()),
            nullable=True,
        ),
        sa.PrimaryKeyConstraint(
            "project_id",
            "id",
        ),
        sa.UniqueConstraint(
            "project_id",
            "slug",
        ),
        sa.ForeignKeyConstraint(
            ["project_id"],
            ["projects.id"],
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["project_id", "artifact_id"],
            ["query_artifacts.project_id", "query_artifacts.id"],
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["project_id", "variant_id"],
            ["query_variants.project_id", "query_variants.id"],
            ondelete="CASCADE",
        ),
        sa.Index(
            "ix_query_revisions_project_id_slug",
            "project_id",
            "slug",
        ),
        sa.Index(
            "ix_query_revisions_project_id_artifact_id",
            "project_id",
            "artifact_id",
        ),
        sa.Index(
            "ix_query_revisions_project_id_variant_id",
            "project_id",
            "variant_id",
        ),
    )

    # --------------------------------------------------------------------------


def downgrade() -> None:
    # - REVISIONS --------------------------------------------------------------

    op.drop_table("query_revisions")

    # --------------------------------------------------------------------------

    # - VARIANTS ---------------------------------------------------------------

    op.drop_table("query_variants")

    # --------------------------------------------------------------------------

    # - ARTIFACTS --------------------------------------------------------------

    op.drop_table("query_artifacts")

    # --------------------------------------------------------------------------
