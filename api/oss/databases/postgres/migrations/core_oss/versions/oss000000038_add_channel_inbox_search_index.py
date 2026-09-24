"""full-text index over stored channel message text

Revision ID: oss000000038
Revises: oss000000037
Create Date: 2026-09-24 00:00:00.000000

`search_channel_messages` searches the text of stored inbox messages. An
expression index keeps no second copy of the text; every query must repeat
the exact expression, which the DAO keeps in one helper. `simple` assumes no
language.
"""

from typing import Sequence, Union

from alembic import op
from sqlalchemy import text

revision: str = "oss000000038"
down_revision: Union[str, None] = "oss000000037"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # CREATE INDEX CONCURRENTLY cannot run inside a transaction.
    with op.get_context().autocommit_block():
        op.execute(
            text(
                """
                CREATE INDEX CONCURRENTLY IF NOT EXISTS ix_channel_inbox_events_search
                ON channel_inbox_events USING gin (
                    to_tsvector(
                        'simple',
                        coalesce(data #>> '{processed,content,0,text}', '')
                    )
                );
                """
            )
        )


def downgrade() -> None:
    with op.get_context().autocommit_block():
        op.execute(
            text("DROP INDEX CONCURRENTLY IF EXISTS ix_channel_inbox_events_search;")
        )
