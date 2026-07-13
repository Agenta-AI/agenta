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

    # Only add each key where absent — never overwrite an already-set value. Each row
    # records which keys THIS backfill added, under a private marker key: an explicit
    # false is otherwise indistinguishable from one a caller stored, and downgrade must
    # not strip the latter.
    conn.execute(
        sa.text(
            """
            UPDATE workflow_revisions
            SET flags = COALESCE(flags, '{}'::jsonb)
                || CASE WHEN NOT (COALESCE(flags, '{}'::jsonb) ? 'is_agent')
                        THEN '{"is_agent": false}'::jsonb ELSE '{}'::jsonb END
                || CASE WHEN NOT (COALESCE(flags, '{}'::jsonb) ? 'is_skill')
                        THEN '{"is_skill": false}'::jsonb ELSE '{}'::jsonb END
                || jsonb_build_object(
                       '__oss000000010__',
                       (CASE WHEN NOT (COALESCE(flags, '{}'::jsonb) ? 'is_agent')
                             THEN '["is_agent"]'::jsonb ELSE '[]'::jsonb END)
                       || (CASE WHEN NOT (COALESCE(flags, '{}'::jsonb) ? 'is_skill')
                                THEN '["is_skill"]'::jsonb ELSE '[]'::jsonb END)
                   )
            WHERE flags IS NULL
               OR NOT (flags ? 'is_agent')
               OR NOT (flags ? 'is_skill')
            """
        )
    )


def downgrade() -> None:
    conn = op.get_bind()

    # Strip only the keys this backfill added, per row, then drop the marker.
    conn.execute(
        sa.text(
            """
            UPDATE workflow_revisions
            SET flags = (
                    SELECT COALESCE(jsonb_object_agg(kv.key, kv.value), '{}'::jsonb)
                    FROM jsonb_each(flags) AS kv
                    WHERE kv.key <> '__oss000000010__'
                      AND NOT (flags -> '__oss000000010__' ? kv.key)
                )
            WHERE flags ? '__oss000000010__'
            """
        )
    )
