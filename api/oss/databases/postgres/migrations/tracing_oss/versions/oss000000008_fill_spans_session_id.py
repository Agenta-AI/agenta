"""fill spans.session_id from the session id that a span carries

Revision ID: oss000000008
Revises: oss000000007
Create Date: 2026-10-28 00:00:00.000000

Trace privacy (M9) hides a trace when one of its spans names a session the reader may
not read, and reads that link from `spans.session_id`. Ingest used to set the column on
root spans only, but an agent run carries the session id on its agent span, which is a
child of the workflow span. Ingest now sets it on every span that carries
`ag.session.id`; this revision does the same for the spans already stored.

Only spans whose attributes contain `ag.session` are read, through the GIN index on
`attributes`, in batches, so the table is never locked for long. A rerun finds nothing
left to fill.

Old code on the filled rows: it reads the column only for session filtering of root
spans, which keep their value. The downgrade keeps the values: the column existed
before.
"""

from typing import Sequence, Union

from alembic import op
from sqlalchemy import text

revision: str = "oss000000008"
down_revision: Union[str, None] = "oss000000007"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

_BATCH_SIZE = 5000

_FILL_BATCH_SQL = """
WITH batch AS (
    SELECT project_id, trace_id, span_id
    FROM spans
    WHERE attributes @> '{"ag": {"session": {}}}'::jsonb
      AND session_id IS NULL
      AND jsonb_typeof(attributes -> 'ag' -> 'session' -> 'id') = 'string'
    LIMIT :batch_size
)
UPDATE spans s
SET session_id = s.attributes -> 'ag' -> 'session' ->> 'id'
FROM batch b
WHERE s.project_id = b.project_id
  AND s.trace_id = b.trace_id
  AND s.span_id = b.span_id
"""


def upgrade() -> None:
    connection = op.get_bind()
    while True:
        result = connection.execute(text(_FILL_BATCH_SQL), {"batch_size": _BATCH_SIZE})
        if (result.rowcount or 0) < _BATCH_SIZE:
            break


def downgrade() -> None:
    # The values are correct for the older code too; nothing to undo.
    pass
