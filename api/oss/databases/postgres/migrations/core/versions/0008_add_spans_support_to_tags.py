"""add spans to tags registry (no triggers, manual or async batch processing only)

Revision ID: 0008_add_spans_to_tags
Revises: 0007_backfill_blobs
Create Date: 2025-11-27 12:00:00.000000

Notes:
  Spans are a high-volume entity and do not have trigger-based sync.
  Tag keys can be manually added to the tags registry for spans,
  or batch-added via async processing if needed.
  This migration does NOT create any triggers for spans.

"""

from typing import Sequence, Union

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "0008_add_spans_to_tags"
down_revision: Union[str, None] = "0007_backfill_blobs"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # NOTE: NO TRIGGERS are created for spans due to high volume.
    # Tag keys for spans can be:
    # 1. Manually inserted into tags table via API or admin tools
    # 2. Batch-inserted periodically via async job (future)
    # 3. Inserted on-demand when autocomplete is needed (future)
    #
    # The tags table structure already supports spans via (project_id, kind, key).
    # kind='span' can be used just like any other entity kind.
    #
    # This migration serves as documentation that spans support exists
    # but is not automatically maintained via triggers.
    pass


def downgrade() -> None:
    # Remove any manually inserted span tags if needed
    # This is safe to keep as the table structure supports all kinds equally
    pass
