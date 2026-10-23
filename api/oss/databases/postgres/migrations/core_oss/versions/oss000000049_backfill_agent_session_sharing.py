"""backfill legacy agents and sessions as project-visible

Revision ID: oss000000049
Revises: oss000000048
Create Date: 2026-10-23 00:00:00.000000

The data half of the sharing change (`oss000000048` added the schema and committed).

The legacy population is fixed: every agent artifact that exists when this revision
runs, and every `session_streams` row with `visibility IS NULL`. The Helm hook runs this
revision before any new pod starts, so every row it reads was written by pre-sharing
code. It is never rerun, and nothing runs after the rollout. A null owner is never a
marker: a new ownerless row always has a non-null visibility, so this revision never
touches it.

1. Agents. One `project` row in `agent_access` per artifact, archived or not, that has a
   revision flagged `is_agent` and a non-null `created_by_id`. The owner is that
   creator. An agent without a creator gets no row (no row = project-visible,
   ownerless). Prompts and evaluators get no row.
2. Sessions. Every legacy session becomes `project`. Its owner follows the ownership
   rule of the sharing contract, decided by ONE group of fields:
   - a channel session (a `channel_threads` row names it) has no owner;
   - when the first turn records a run principal (`principal_kind`), the run principal
     fields decide, as stored, a null sender included: the sender owns a `web` or `api`
     turn, a human principal owns a `web` or `schedule` turn, everything else
     (installation, subscription, child, evaluation, an API key without a sender) has
     no owner;
   - only when the first turn has no `principal_kind` (written before run principals),
     the stream creator owns, else the first turn's creator, else nobody. A pre-run-
     principal API-key session goes to the key creator, because that data cannot tell a
     key from a human (accepted).
   The two groups are never mixed.

Every statement runs in an autocommit block as its own transaction, with
`lock_timeout = 5s` and `statement_timeout = 60s`, so no schema lock is held during the
backfill. Sessions are walked in keyset batches of 5,000 by the primary key
`(project_id, id)`. Both statements only touch rows that are not done, so a rerun after
a timeout resumes, and a second run changes no row. `downgrade()` is a no-op.

The same session statement, for one row, is `SharingDAO.assign_legacy_session_access`:
the first direct access on a new pod to a row an old pod wrote during the rolling deploy.
"""

from typing import Sequence, Union

from alembic import op
from sqlalchemy import text

revision: str = "oss000000049"
down_revision: Union[str, None] = "oss000000048"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


BATCH_SIZE = 5000

_START_KEY = {
    "last_p": "00000000-0000-0000-0000-000000000000",
    "last_id": "00000000-0000-0000-0000-000000000000",
}

# One statement: every agent artifact with a creator gets a project row owned by it.
_BACKFILL_AGENTS_SQL = """
INSERT INTO agent_access (project_id, artifact_id, visibility, owner_user_id, created_by_id)
SELECT a.project_id, a.id, 'project', a.created_by_id, a.created_by_id
FROM workflow_artifacts a
WHERE a.created_by_id IS NOT NULL
  AND EXISTS (
      SELECT 1 FROM workflow_revisions r
      WHERE r.project_id = a.project_id
        AND r.artifact_id = a.id
        AND r.flags @> '{"is_agent": true}'::jsonb
  )
ON CONFLICT (project_id, artifact_id) DO NOTHING
"""

# One batch of legacy sessions. The walk advances on the last key of `batch`, so a
# batch that changes nothing still moves forward.
_BACKFILL_SESSIONS_BATCH_SQL = """
WITH batch AS (
    SELECT s.project_id, s.id, s.session_id, s.created_by_id
    FROM session_streams s
    WHERE s.visibility IS NULL
      AND (s.project_id, s.id) > (CAST(:last_p AS uuid), CAST(:last_id AS uuid))
    ORDER BY s.project_id, s.id
    LIMIT :batch_size
), first_turn AS (
    SELECT DISTINCT ON (t.project_id, t.session_id)
           t.project_id, t.session_id, t.principal_kind, t.principal_id,
           t.sender_user_id, t.origin, t.created_by_id
    FROM session_turns t
    JOIN batch b ON t.project_id = b.project_id AND t.session_id = b.session_id
    ORDER BY t.project_id, t.session_id, t.created_at, t.turn_index
), owner AS (
    SELECT b.project_id, b.id,
        CASE
            WHEN EXISTS (
                SELECT 1 FROM channel_threads c
                WHERE c.project_id = b.project_id AND c.session_id = b.session_id
            ) THEN NULL
            -- Run principal attribution: the stored fields decide, a null sender included.
            WHEN f.principal_kind IS NOT NULL THEN
                CASE
                    WHEN f.origin = 'installation' THEN NULL
                    WHEN f.sender_user_id IS NOT NULL AND f.origin IN ('web', 'api')
                        THEN f.sender_user_id
                    WHEN f.principal_kind = 'human' AND f.origin IN ('web', 'schedule')
                        THEN f.principal_id
                    ELSE NULL
                END
            -- Rows written before run principals only: the creator.
            ELSE COALESCE(b.created_by_id, f.created_by_id)
        END AS owner_user_id
    FROM batch b
    LEFT JOIN first_turn f
      ON f.project_id = b.project_id AND f.session_id = b.session_id
), changed AS (
    UPDATE session_streams s
    SET visibility = 'project', owner_user_id = o.owner_user_id
    FROM owner o
    WHERE s.project_id = o.project_id AND s.id = o.id AND s.visibility IS NULL
    RETURNING s.project_id, s.id
)
SELECT (SELECT count(*) FROM changed) AS changed, last.project_id, last.id
FROM (
    SELECT b.project_id, b.id FROM batch b
    ORDER BY b.project_id DESC, b.id DESC
    LIMIT 1
) last
"""


def _backfill_agents(connection) -> int:
    return int(connection.execute(text(_BACKFILL_AGENTS_SQL)).rowcount or 0)


def _backfill_sessions(connection) -> int:
    """Walk the legacy sessions batch after batch. In an autocommit block each batch is
    its own transaction. Returns the number of rows updated."""

    updated = 0
    key = dict(_START_KEY)
    while True:
        row = connection.execute(
            text(_BACKFILL_SESSIONS_BATCH_SQL), {**key, "batch_size": BATCH_SIZE}
        ).first()
        if row is None:  # the batch was empty: past the last legacy row
            return updated
        updated += int(row.changed or 0)
        key = {"last_p": str(row.project_id), "last_id": str(row.id)}


def upgrade() -> None:
    with op.get_context().autocommit_block():
        connection = op.get_bind()
        # Session settings: in the autocommit block every statement below is its own
        # transaction, and each one waits at most 5 s for a lock and runs at most 60 s.
        connection.execute(text("SET lock_timeout = '5s'"))
        connection.execute(text("SET statement_timeout = '60s'"))
        try:
            agents = _backfill_agents(connection)
            sessions = _backfill_sessions(connection)
        finally:
            connection.execute(text("RESET lock_timeout"))
            connection.execute(text("RESET statement_timeout"))
        print(f"[sharing] backfill: agents={agents} sessions={sessions}")


def downgrade() -> None:
    pass
