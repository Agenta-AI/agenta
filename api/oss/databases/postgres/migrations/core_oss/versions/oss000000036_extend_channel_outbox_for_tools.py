"""let channel outbox rows target a space without a thread

Revision ID: oss000000036
Revises: oss000000035
Create Date: 2026-09-24 00:00:00.000000

`send_channel_message` posts from any run, so its delivery record has no
channel thread: `thread_id` becomes nullable. Every row now names its space,
so the channel read tool finds the bot's own posts without a join; existing
turn rows take their thread's space.
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "oss000000036"
down_revision: Union[str, None] = "oss000000035"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.alter_column("channel_outbox_events", "thread_id", nullable=True)
    op.add_column(
        "channel_outbox_events",
        sa.Column("space_id", sa.UUID(as_uuid=True), nullable=True),
    )
    op.execute(
        """
        UPDATE channel_outbox_events AS o
        SET space_id = t.space_id
        FROM channel_threads AS t
        WHERE t.project_id = o.project_id AND t.id = o.thread_id
        """
    )
    op.create_index(
        "ix_channel_outbox_space",
        "channel_outbox_events",
        ["project_id", "space_id", "created_at"],
    )


def downgrade() -> None:
    op.drop_index("ix_channel_outbox_space", table_name="channel_outbox_events")
    op.drop_column("channel_outbox_events", "space_id")
    op.execute("DELETE FROM channel_outbox_events WHERE thread_id IS NULL")
    op.alter_column("channel_outbox_events", "thread_id", nullable=False)
