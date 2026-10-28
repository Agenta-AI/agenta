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
`attributes`, in one statement in an autocommit block, so it holds row locks only on
those spans and commits on its own. Agent runs are a small share of spans. A rerun finds
nothing left to fill.

Old code on the filled rows: it reads the column only for session filtering of root
spans, which keep their value. The downgrade keeps the values: the column existed
before.
"""

from typing import Sequence, Union

from alembic import op

revision: str = "oss000000008"
down_revision: Union[str, None] = "oss000000007"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

_FILL_SQL = """
UPDATE spans
SET session_id = attributes -> 'ag' -> 'session' ->> 'id'
WHERE attributes @> '{"ag": {"session": {}}}'::jsonb
  AND session_id IS NULL
  AND jsonb_typeof(attributes -> 'ag' -> 'session' -> 'id') = 'string'
"""


def upgrade() -> None:
    with op.get_context().autocommit_block():
        op.execute(_FILL_SQL)


def downgrade() -> None:
    # The values are correct for the older code too; nothing to undo.
    pass
