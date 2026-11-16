"""state the drives of every stored agent revision

An agent configuration names the drives it mounts in `drives` and whether its sessions
keep a working folder in `has_session_drive`. Code from the release before this one
reads a configuration without the keys as `"drives": [{"kind": "agent"}]` and
`"has_session_drive": true`. This revision writes exactly these values into
`data.parameters.agent` of every agent revision (`flags.is_agent`) that lacks them, so
each stored configuration states the drives it already had. Data only, no schema change.

Each key is added only where absent; a value a revision states is kept, so a second run
changes nothing. Revisions that environments point to are rewritten too, on purpose.

Revision ID: oss000000063
Revises: oss000000062
Create Date: 2026-11-16 00:00:00.000000
"""

import logging
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "oss000000063"
down_revision: Union[str, None] = "oss000000062"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

log = logging.getLogger("alembic.runtime.migration")

# The WHERE clause reads `data` through json operators only, so rows it skips are never
# cast to jsonb.
_BACKFILL_SQL = """
UPDATE workflow_revisions
SET data = jsonb_set(
    data::jsonb,
    '{parameters,agent}',
    jsonb_build_object(
        'has_session_drive', true,
        'drives', '[{"kind": "agent"}]'::jsonb
    ) || (data::jsonb -> 'parameters' -> 'agent')
)::json
WHERE flags @> '{"is_agent": true}'::jsonb
  AND json_typeof(data -> 'parameters' -> 'agent') = 'object'
  AND (
      (data -> 'parameters' -> 'agent' -> 'has_session_drive') IS NULL
      OR (data -> 'parameters' -> 'agent' -> 'drives') IS NULL
  )
"""


def upgrade() -> None:
    op.execute("SET LOCAL lock_timeout = '2s'")
    result = op.get_bind().execute(sa.text(_BACKFILL_SQL))
    log.info("stated the drives of %s agent revisions", result.rowcount)


def downgrade() -> None:
    # Nothing to undo: the database is never rolled back on a failed deploy, and the
    # code of the release before this one reads the added keys.
    pass
