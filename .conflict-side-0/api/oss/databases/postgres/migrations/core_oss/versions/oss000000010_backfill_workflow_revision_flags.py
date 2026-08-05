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

    # Record which rows this backfill touched, and which keys it added to each, in a
    # side table — not inside `flags` itself. An explicit false is indistinguishable
    # from one a caller stored, so downgrade needs provenance; but `flags` is
    # user-facing and typed (Dict[str, bool | str | dict]), so bookkeeping must not
    # live there.
    conn.execute(
        sa.text(
            """
            CREATE TABLE IF NOT EXISTS oss000000010_backfilled_flags (
                revision_id uuid NOT NULL,
                project_id  uuid NOT NULL,
                added_keys  text[] NOT NULL,
                PRIMARY KEY (project_id, revision_id)
            )
            """
        )
    )

    conn.execute(
        sa.text(
            """
            INSERT INTO oss000000010_backfilled_flags (revision_id, project_id, added_keys)
            SELECT id, project_id,
                   ARRAY(
                       SELECT k FROM unnest(ARRAY['is_agent', 'is_skill']) AS k
                       WHERE NOT (COALESCE(flags, '{}'::jsonb) ? k)
                   )
            FROM workflow_revisions
            WHERE flags IS NULL
               OR NOT (flags ? 'is_agent')
               OR NOT (flags ? 'is_skill')
            ON CONFLICT DO NOTHING
            """
        )
    )

    # Add each key only where absent; never overwrite a value a caller already stored.
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
    conn = op.get_bind()

    # Strip only the keys this backfill added, per row, from its recorded provenance.
    conn.execute(
        sa.text(
            """
            UPDATE workflow_revisions AS wr
            SET flags = (
                    SELECT COALESCE(jsonb_object_agg(kv.key, kv.value), '{}'::jsonb)
                    FROM jsonb_each(wr.flags) AS kv
                    WHERE NOT (kv.key = ANY(b.added_keys))
                )
            FROM oss000000010_backfilled_flags AS b
            WHERE wr.id = b.revision_id
              AND wr.project_id = b.project_id
              AND wr.flags IS NOT NULL
            """
        )
    )

    conn.execute(sa.text("DROP TABLE IF EXISTS oss000000010_backfilled_flags"))
