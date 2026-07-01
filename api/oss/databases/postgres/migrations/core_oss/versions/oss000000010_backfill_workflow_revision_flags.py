"""backfill workflow_revisions flags (is_agent, is_skill)

is_agent and is_skill were added to WorkflowRevisionFlags in big-agents with no
backfill. Pre-existing rows lack the keys in stored JSON, so a containment filter
(flags @> {"is_agent": false}) silently drops them — null and false are distinct
result sets. Materialize both keys to false where absent; existing values win.

is_static is server-owned (slug-derived, never stored/filtered), so it is not
backfilled here.

Revision ID: oss000000010
Revises: oss000000009
Create Date: 2026-07-01 00:00:00.000000

"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "oss000000010"
down_revision: Union[str, None] = "oss000000009"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    conn = op.get_bind()

    # Only add each key where absent — never overwrite an already-set value.
    conn.execute(
        sa.text(
            """
            UPDATE workflow_revisions
            SET flags = COALESCE(flags, '{}'::jsonb)
                || CASE WHEN NOT (COALESCE(flags, '{}'::jsonb) ? 'is_agent')
                        THEN '{"is_agent": false}'::jsonb ELSE '{}'::jsonb END
                || CASE WHEN NOT (COALESCE(flags, '{}'::jsonb) ? 'is_skill')
                        THEN '{"is_skill": false}'::jsonb ELSE '{}'::jsonb END
            WHERE flags IS NULL
               OR NOT (flags ? 'is_agent')
               OR NOT (flags ? 'is_skill')
            """
        )
    )


def downgrade() -> None:
    # Strip only the false values this backfill added; leave rows that carried
    # a real (true) value or predate the keys untouched beyond the removal.
    conn = op.get_bind()
    conn.execute(
        sa.text(
            """
            UPDATE workflow_revisions
            SET flags = flags - 'is_agent' - 'is_skill'
            WHERE (flags ->> 'is_agent') = 'false'
               OR (flags ->> 'is_skill') = 'false'
            """
        )
    )
