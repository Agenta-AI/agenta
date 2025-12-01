"""backfill tags table from existing workflow entities

Revision ID: 0003_backfill_workflows
Revises: 0002_add_sync_tags_trigger
Create Date: 2025-11-27 10:30:00.000000

"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision: str = "0003_backfill_workflows"
down_revision: Union[str, None] = "0002_add_sync_tags_trigger"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Backfill tags from workflow_artifacts
    op.execute("""
    INSERT INTO tags(project_id, kind, key)
    SELECT DISTINCT project_id, 'workflow'::text, key
    FROM workflow_artifacts
    CROSS JOIN LATERAL jsonb_object_keys(tags) AS key
    WHERE tags IS NOT NULL
    ON CONFLICT (project_id, kind, key) DO NOTHING;
    """)

    # Backfill tags from workflow_variants
    op.execute("""
    INSERT INTO tags(project_id, kind, key)
    SELECT DISTINCT project_id, 'workflow'::text, key
    FROM workflow_variants
    CROSS JOIN LATERAL jsonb_object_keys(tags) AS key
    WHERE tags IS NOT NULL
    ON CONFLICT (project_id, kind, key) DO NOTHING;
    """)

    # Backfill tags from workflow_revisions
    op.execute("""
    INSERT INTO tags(project_id, kind, key)
    SELECT DISTINCT project_id, 'workflow'::text, key
    FROM workflow_revisions
    CROSS JOIN LATERAL jsonb_object_keys(tags) AS key
    WHERE tags IS NOT NULL
    ON CONFLICT (project_id, kind, key) DO NOTHING;
    """)


def downgrade() -> None:
    # Remove backfilled tags for workflows
    op.execute("""
    DELETE FROM tags
    WHERE kind = 'workflow';
    """)
