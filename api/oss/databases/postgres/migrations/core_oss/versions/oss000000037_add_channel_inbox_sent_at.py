"""record the provider's time on stored channel messages

Revision ID: oss000000037
Revises: oss000000036
Create Date: 2026-09-24 00:00:00.000000

The channel read tool serves a space's stored messages in the provider's
order. Adapters now record that time; rows stored before this change take
their arrival time, which is what their order already reflected.
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "oss000000037"
down_revision: Union[str, None] = "oss000000036"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "channel_inbox_events",
        sa.Column("sent_at", sa.TIMESTAMP(timezone=True), nullable=True),
    )
    op.execute("UPDATE channel_inbox_events SET sent_at = created_at")
    op.create_index(
        "ix_channel_inbox_events_sent",
        "channel_inbox_events",
        ["project_id", "space_id", "sent_at", "id"],
    )


def downgrade() -> None:
    op.drop_index("ix_channel_inbox_events_sent", table_name="channel_inbox_events")
    op.drop_column("channel_inbox_events", "sent_at")
