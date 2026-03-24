"""convert_workflow_artifacts_and_variants_and_revision_to_partial_index

Revision ID: bd84ed86112a
Revises: f0a1b2c3d4e5
Create Date: 2026-03-20 19:55:05.688870

"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = "bd84ed86112a"
down_revision: Union[str, None] = "f0a1b2c3d4e5"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # drop the previous constraint that enforces unique on both slug and project id
    # This case will cover the situation where someone may have called down -v and nuked all history and rebuilt it
    # IMPORTANT to note that rebuilding based on the migrations DOES NOT CREATE the original unique(project_id, slug)
    # This may have been created manually and not through alembic, therefore we have a check here to see if anyone is in
    # that case vs the normal case where we can just update it normally with this execution
    op.execute("ALTER TABLE workflow_artifacts DROP CONSTRAINT IF EXISTS workflow_artifacts_project_id_slug_key")
    op.execute("ALTER TABLE workflow_variants DROP CONSTRAINT IF EXISTS workflow_variants_project_id_slug_key")
    op.execute("ALTER TABLE workflow_revisions DROP CONSTRAINT IF EXISTS workflow_revisions_project_id_slug_key")

    # create the new partial index if it does not exist
    op.execute("CREATE UNIQUE INDEX IF NOT EXISTS uq_workflow_artifacts_project_id_slug_active ON workflow_artifacts (project_id, slug) WHERE deleted_at IS NULL")
    op.execute("CREATE UNIQUE INDEX IF NOT EXISTS uq_workflow_variants_project_id_slug_active ON workflow_variants (project_id, slug) WHERE deleted_at IS NULL")
    op.execute("CREATE UNIQUE INDEX IF NOT EXISTS uq_workflow_revisions_project_id_slug_active ON workflow_revisions (project_id, slug) WHERE deleted_at IS NULL")


def downgrade() -> None:
    op.drop_index(
        "uq_workflow_artifacts_project_id_slug_active", table_name="workflow_artifacts"
    )
    op.drop_index(
        "uq_workflow_variants_project_id_slug_active", table_name="workflow_variants"
    )
    op.drop_index(
        "uq_workflow_revisions_project_id_slug_active", table_name="workflow_revisions"
    )

    op.create_unique_constraint(
        "workflow_artifacts_project_id_slug_key",
        "workflow_artifacts",
        ["project_id", "slug"],
    )
    op.create_unique_constraint(
        "workflow_variants_project_id_slug_key",
        "workflow_variants",
        ["project_id", "slug"],
    )
    op.create_unique_constraint(
        "workflow_revisions_project_id_slug_key",
        "workflow_revisions",
        ["project_id", "slug"],
    )
