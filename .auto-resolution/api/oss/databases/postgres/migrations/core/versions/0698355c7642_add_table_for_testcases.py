"""add tables for testcases (blobs)

Revision ID: 0698355c7642
Revises: 0698355c7641
Create Date: 2025-04-24 07:27:45.801481

"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision: str = "0698355c7642"
down_revision: Union[str, None] = "0698355c7641"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # - BLOBS ------------------------------------------------------------------

    op.create_table(
        "testcase_blobs",
        sa.Column(
            "project_id",
            sa.UUID(),
            nullable=False,
        ),
        sa.Column(
            "set_id",
            sa.UUID(),
            nullable=True,
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
        sa.UniqueConstraint(
            "project_id",
            "set_id",
            "id",
        ),
        sa.UniqueConstraint(
            "project_id",
            "set_id",
            "slug",
        ),
        sa.ForeignKeyConstraint(
            ["project_id"],
            ["projects.id"],
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["project_id", "set_id"],
            ["testset_artifacts.project_id", "testset_artifacts.id"],
            ondelete="CASCADE",
        ),
        sa.Index(
            "ix_testcase_blobs_project_id_blob_slug",
            "project_id",
            "slug",
        ),
        sa.Index(
            "ix_testcase_blobs_project_id_set_id",
            "project_id",
            "set_id",
        ),
        sa.Index(
            "ix_testcase_blobs_project_id_set_id_id",
            "project_id",
            "set_id",
            "id",
        ),
        sa.Index(
            "ix_testcase_blobs_project_id_set_id_slug",
            "project_id",
            "set_id",
            "slug",
        ),
    )

    # --------------------------------------------------------------------------


def downgrade() -> None:
    # - BLOBS ------------------------------------------------------------------

    op.drop_table("testcase_blobs")

    # --------------------------------------------------------------------------
