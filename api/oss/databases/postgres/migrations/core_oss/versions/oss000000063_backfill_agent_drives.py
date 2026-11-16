"""state the drives of every stored agent revision

An agent configuration names the drives it mounts in `drives` and whether its sessions
keep a working folder in `has_session_drive`. Code from the release before this one
reads a configuration without the keys as `"drives": [{"kind": "agent"}]` and
`"has_session_drive": true`. This revision writes exactly these values into
`data.parameters.agent` of every agent revision (`flags.is_agent`) that lacks them, so
each stored configuration states the drives it already had. Data only, no schema change.

Each key is added where absent or null; a value a revision states is kept, so a second run
changes nothing. Revisions that environments point to are rewritten too, on purpose.

Revision ID: oss000000063
Revises: oss000000062
Create Date: 2026-11-16 00:00:00.000000
"""

import json
import logging
from typing import Optional, Sequence, Union
from uuid import UUID

import sqlalchemy as sa
from alembic import op

revision: str = "oss000000063"
down_revision: Union[str, None] = "oss000000062"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

log = logging.getLogger("alembic.runtime.migration")

BATCH_SIZE = 500

# Read as text and merged in Python: json operators and jsonb refuse a stored "\u0000".
_READ_SQL = """
SELECT project_id, id, data::text
FROM workflow_revisions
WHERE flags @> '{"is_agent": true}'::jsonb
  AND data IS NOT NULL
  AND (project_id, id) > (:project_id, :id)
ORDER BY project_id, id
LIMIT :limit
"""

_WRITE_SQL = """
UPDATE workflow_revisions
SET data = CAST(:data AS json)
WHERE project_id = :project_id AND id = :id
"""


def _with_drives(text: str) -> Optional[str]:
    """The data with the missing drive keys added, or None when nothing changes."""
    data = json.loads(text)
    parameters = data.get("parameters") if isinstance(data, dict) else None
    agent = parameters.get("agent") if isinstance(parameters, dict) else None
    if not isinstance(agent, dict):
        return None
    changed = False
    if agent.get("has_session_drive") is None:
        agent["has_session_drive"] = True
        changed = True
    if agent.get("drives") is None:
        agent["drives"] = [{"kind": "agent"}]
        changed = True
    return json.dumps(data) if changed else None


def _backfill(connection, *, batch_size: int = BATCH_SIZE) -> int:
    changed = 0
    last = {"project_id": UUID(int=0), "id": UUID(int=0)}
    while True:
        rows = connection.execute(
            sa.text(_READ_SQL), {**last, "limit": batch_size}
        ).all()
        if not rows:
            return changed
        updates = []
        for project_id, revision_id, text in rows:
            merged = _with_drives(text)
            if merged is not None:
                updates.append(
                    {"project_id": project_id, "id": revision_id, "data": merged}
                )
        if updates:
            connection.execute(sa.text(_WRITE_SQL), updates)
            changed += len(updates)
        last = {"project_id": rows[-1][0], "id": rows[-1][1]}


def upgrade() -> None:
    op.execute("SET LOCAL lock_timeout = '2s'")
    count = _backfill(op.get_bind())
    log.info("stated the drives of %s agent revisions", count)


def downgrade() -> None:
    # Nothing to undo: the database is never rolled back on a failed deploy, and the
    # code of the release before this one reads the added keys.
    pass
