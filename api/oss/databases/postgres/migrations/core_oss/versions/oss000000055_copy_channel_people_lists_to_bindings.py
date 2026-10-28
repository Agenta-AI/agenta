"""copy channel people lists from the installation to every agent binding

"Who can message it" moves from the installation (`channel_connections.data.allowed_senders`)
to the agent binding (`channel_agents.data.audience.senders`): one installation can hold
several agents (the hosted Slack app has one installation per workspace), and the list
must apply only to the agent it was set for.

This revision copies each installation's non-empty list to every binding of that
installation that has no `audience` yet. Ids are stored as strings (Telegram ids were
sometimes numbers). Data only, no schema change.

Old code during the rollout reads `allowed_senders`, which this revision leaves in place,
so an old pod keeps enforcing the list it knew. New code reads only the binding.

The downgrade removes `audience` from every binding. Old code then reads the installation
lists again, as they were before the upgrade. Lists set or changed after the upgrade are
lost on a rollback.

Revision ID: oss000000055
Revises: oss000000054
Create Date: 2026-10-28 00:00:00.000000
"""

import logging
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "oss000000055"
down_revision: Union[str, None] = "oss000000054"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

log = logging.getLogger("alembic.runtime.migration")

_COPY_SQL = """
UPDATE channel_agents AS a
SET data = jsonb_set(
    COALESCE(a.data::jsonb, '{}'::jsonb),
    '{audience}',
    jsonb_build_object(
        'senders',
        (
            SELECT jsonb_agg(to_jsonb(item #>> '{}'))
            FROM jsonb_array_elements(c.data::jsonb -> 'allowed_senders') AS item
            WHERE NULLIF(btrim(item #>> '{}'), '') IS NOT NULL
        )
    )
)::json
FROM channel_connections AS c
WHERE c.project_id = a.project_id
  AND c.id = a.connection_id
  AND jsonb_typeof(c.data::jsonb -> 'allowed_senders') = 'array'
  AND EXISTS (
      SELECT 1
      FROM jsonb_array_elements(c.data::jsonb -> 'allowed_senders') AS item
      WHERE NULLIF(btrim(item #>> '{}'), '') IS NOT NULL
  )
  AND (a.data::jsonb -> 'audience') IS NULL
"""

_REMOVE_SQL = """
UPDATE channel_agents
SET data = (data::jsonb - 'audience')::json
WHERE data IS NOT NULL
  AND data::jsonb ? 'audience'
"""


def upgrade() -> None:
    op.execute("SET LOCAL lock_timeout = '2s'")
    result = op.get_bind().execute(sa.text(_COPY_SQL))
    log.info("copied channel people lists to %s agent bindings", result.rowcount)


def downgrade() -> None:
    op.execute("SET LOCAL lock_timeout = '2s'")
    op.get_bind().execute(sa.text(_REMOVE_SQL))
