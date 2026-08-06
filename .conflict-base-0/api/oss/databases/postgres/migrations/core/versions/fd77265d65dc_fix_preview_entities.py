"""fix previw entities

Revision ID: fd77265d65dc
Revises: 54e81e9eed88
Create Date: 2025-05-29 16:30:00.000000

"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision: str = "fd77265d65dc"
down_revision: Union[str, None] = "54e81e9eed88"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # - WORKFLOWS --------------------------------------------------------------

    op.add_column(
        "workflow_artifacts",
        sa.Column(
            "tags",
            postgresql.JSONB(none_as_null=True),
            nullable=True,
        ),
    )
    op.add_column(
        "workflow_variants",
        sa.Column(
            "tags",
            postgresql.JSONB(none_as_null=True),
            nullable=True,
        ),
    )
    op.add_column(
        "workflow_revisions",
        sa.Column(
            "tags",
            postgresql.JSONB(none_as_null=True),
            nullable=True,
        ),
    )

    # - TESTSETS ---------------------------------------------------------------

    op.add_column(
        "testset_artifacts",
        sa.Column(
            "tags",
            postgresql.JSONB(none_as_null=True),
            nullable=True,
        ),
    )
    op.add_column(
        "testset_variants",
        sa.Column(
            "tags",
            postgresql.JSONB(none_as_null=True),
            nullable=True,
        ),
    )
    op.add_column(
        "testset_revisions",
        sa.Column(
            "tags",
            postgresql.JSONB(none_as_null=True),
            nullable=True,
        ),
    )

    # - TESTCASES --------------------------------------------------------------

    op.add_column(
        "testcase_blobs",
        sa.Column(
            "tags",
            postgresql.JSONB(none_as_null=True),
            nullable=True,
        ),
    )
    op.add_column(
        "testcase_blobs",
        sa.Column(
            "flags",
            postgresql.JSONB(none_as_null=True),
            nullable=True,
        ),
    )
    op.add_column(
        "testcase_blobs",
        sa.Column(
            "meta",
            postgresql.JSONB(none_as_null=True),
            nullable=True,
        ),
    )
    op.drop_column("testcase_blobs", "slug")
    op.add_column(
        "testcase_blobs",
        sa.Column(
            "created_at",
            sa.TIMESTAMP(timezone=True),
            server_default=sa.text("CURRENT_TIMESTAMP"),
            nullable=False,
        ),
    )
    op.add_column(
        "testcase_blobs",
        sa.Column(
            "updated_at",
            sa.TIMESTAMP(timezone=True),
            nullable=True,
        ),
    )
    op.add_column(
        "testcase_blobs",
        sa.Column(
            "deleted_at",
            sa.TIMESTAMP(timezone=True),
            nullable=True,
        ),
    )
    op.add_column(
        "testcase_blobs",
        sa.Column(
            "created_by_id",
            sa.UUID(),
            nullable=False,
        ),
    )
    op.add_column(
        "testcase_blobs",
        sa.Column(
            "updated_by_id",
            sa.UUID(),
            nullable=True,
        ),
    )
    op.add_column(
        "testcase_blobs",
        sa.Column(
            "deleted_by_id",
            sa.UUID(),
            nullable=True,
        ),
    )

    # - EVALUATIONS ------------------------------------------------------------

    op.add_column(
        "evaluation_runs",
        sa.Column(
            "tags",
            postgresql.JSONB(none_as_null=True),
            nullable=True,
        ),
    )
    op.add_column(
        "evaluation_scenarios",
        sa.Column(
            "tags",
            postgresql.JSONB(none_as_null=True),
            nullable=True,
        ),
    )
    op.add_column(
        "evaluation_steps",
        sa.Column(
            "tags",
            postgresql.JSONB(none_as_null=True),
            nullable=True,
        ),
    )
    op.add_column(
        "evaluation_metrics",
        sa.Column(
            "tags",
            postgresql.JSONB(none_as_null=True),
            nullable=True,
        ),
    )

    # --------------------------------------------------------------------------


def downgrade() -> None:
    # - WORKFLOWS --------------------------------------------------------------

    op.drop_column("workflow_artifacts", "tags")
    op.drop_column("workflow_variants", "tags")
    op.drop_column("workflow_revisions", "tags")

    # - TESTSETS ---------------------------------------------------------------

    op.drop_column("testset_artifacts", "tags")
    op.drop_column("testset_variants", "tags")
    op.drop_column("testset_revisions", "tags")

    # - TESTCASES --------------------------------------------------------------

    op.drop_column("testcase_blobs", "flags")
    op.drop_column("testcase_blobs", "tags")
    op.drop_column("testcase_blobs", "meta")
    op.add_column(
        "testcase_blobs",
        sa.Column(
            "slug",
            sa.String(),
            nullable=True,
        ),
    )
    op.drop_column("testcase_blobs", "created_at")
    op.drop_column("testcase_blobs", "updated_at")
    op.drop_column("testcase_blobs", "deleted_at")
    op.drop_column("testcase_blobs", "created_by_id")
    op.drop_column("testcase_blobs", "updated_by_id")
    op.drop_column("testcase_blobs", "deleted_by_id")

    # - EVALUATIONS ------------------------------------------------------------

    op.drop_column("evaluation_runs", "tags")
    op.drop_column("evaluation_scenarios", "tags")
    op.drop_column("evaluation_steps", "tags")
    op.drop_column("evaluation_metrics", "tags")

    # --------------------------------------------------------------------------
