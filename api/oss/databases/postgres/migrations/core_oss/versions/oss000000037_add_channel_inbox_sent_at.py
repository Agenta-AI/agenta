"""record the provider's time on stored channel messages

Revision ID: oss000000037
Revises: oss000000036
Create Date: 2026-09-24 00:00:00.000000

The channel read tool serves a space's stored messages in the provider's
order. Adapters now record that time; rows stored before this change take
their arrival time, which is what their order already reflected.
"""

from typing import Sequence, Union

from alembic import op

revision: str = "oss000000037"
down_revision: Union[str, None] = "oss000000036"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # idempotent, so a retry after an interrupted index build below succeeds
    op.execute(
        "ALTER TABLE channel_inbox_events "
        "ADD COLUMN IF NOT EXISTS sent_at TIMESTAMP WITH TIME ZONE"
    )
    op.execute(
        "UPDATE channel_inbox_events SET sent_at = created_at WHERE sent_at IS NULL"
    )
    # built without blocking the inbox's writes; an interrupted concurrent
    # build leaves an invalid index, so drop any leftover first
    with op.get_context().autocommit_block():
        op.execute("DROP INDEX CONCURRENTLY IF EXISTS ix_channel_inbox_events_sent")
        op.execute(
            "CREATE INDEX CONCURRENTLY ix_channel_inbox_events_sent "
            "ON channel_inbox_events (project_id, space_id, sent_at, id)"
        )


def downgrade() -> None:
    with op.get_context().autocommit_block():
        op.drop_index(
            "ix_channel_inbox_events_sent",
            table_name="channel_inbox_events",
            postgresql_concurrently=True,
            if_exists=True,
        )
    op.drop_column("channel_inbox_events", "sent_at")
