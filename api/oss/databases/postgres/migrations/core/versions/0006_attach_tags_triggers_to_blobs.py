"""attach tags triggers to blobs

Revision ID: 0006_attach_blobs_trigger
Revises: 0005_backfill_remaining
Create Date: 2025-11-27 11:30:00.000000

"""

from typing import Sequence, Union

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "0006_attach_blobs_trigger"
down_revision: Union[str, None] = "0005_backfill_remaining"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Attach triggers to blobs
    op.execute("""
    CREATE TRIGGER trg_blobs_sync_tags
    AFTER INSERT OR UPDATE ON blobs
    FOR EACH ROW
    EXECUTE FUNCTION sync_tags_from_entity('blob');
    """)


def downgrade() -> None:
    # Drop trigger
    op.execute("DROP TRIGGER IF EXISTS trg_blobs_sync_tags ON blobs")
