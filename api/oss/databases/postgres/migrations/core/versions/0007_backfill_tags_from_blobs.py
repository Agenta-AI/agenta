"""backfill tags table from blobs

Revision ID: 0007_backfill_blobs
Revises: 0006_attach_blobs_trigger
Create Date: 2025-11-27 11:45:00.000000

"""

from typing import Sequence, Union

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "0007_backfill_blobs"
down_revision: Union[str, None] = "0006_attach_blobs_trigger"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Backfill tags from blobs
    op.execute("""
    INSERT INTO tags(project_id, kind, key)
    SELECT DISTINCT project_id, 'blob'::text, key
    FROM blobs
    CROSS JOIN LATERAL jsonb_object_keys(tags) AS key
    WHERE tags IS NOT NULL
    ON CONFLICT (project_id, kind, key) DO NOTHING;
    """)


def downgrade() -> None:
    # Remove backfilled tags for blobs
    op.execute("DELETE FROM tags WHERE kind = 'blob';")
