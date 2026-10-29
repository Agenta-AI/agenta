"""backfill the run principal of schedules, subscriptions and evaluation runs

Revision ID: oss000000047
Revises: oss000000046
Create Date: 2026-10-23 00:00:00.000000

The data half of the run principal change (`oss000000046` added the columns and
committed). Three steps:

1. Legacy principal. `trigger_schedules`, `trigger_subscriptions` and `evaluation_runs`
   rows with a creator get `principal = human(created_by_id)`. This is the only place
   that builds `human(created_by_id)`, and it copies the id as it is, also when that id
   has no `users` row: it is the identity the row runs with today. At run time `decide`
   then denies such a principal (`principal_inactive`) and the trigger is paused.
2. Pause. Schedules and subscriptions that still have no principal (no creator) are
   paused: `flags.is_active = false`, `meta.paused_reason = "missing_principal"`. Their
   ids are printed to the hook log.
3. Target agent. `artifact_id` is set for triggers bound by a direct reference
   (`application`, `evaluator` or `workflow`: its id or slug, its variant id or slug, or
   its revision id), looked up in the trigger's own project. A trigger with any
   `environment` reference keeps `artifact_id` NULL and stays active: its target is
   resolved at each dispatch.

Every statement runs in an autocommit block as its own transaction, with
`lock_timeout = 5s` and `statement_timeout = 60s`, in batches of 1,000 rows walked by
primary key, and touches only rows whose value changes. A timeout fails the hook; a
re-run resumes, because every step skips rows already done. A second run changes no row.
`downgrade()` is a no-op: the columns stay, and old code ignores them.

Read-only counts to run on a copy of a production database before the deploy:

    -- triggers to be paused (no creator)
    SELECT 'schedules', count(*) FROM trigger_schedules
     WHERE created_by_id IS NULL AND deleted_at IS NULL
    UNION ALL
    SELECT 'subscriptions', count(*) FROM trigger_subscriptions
     WHERE created_by_id IS NULL AND deleted_at IS NULL;

    -- triggers and evaluation runs whose creator is not a user (paused or failed at
    -- their next run)
    SELECT 'schedules', count(*) FROM trigger_schedules t
     WHERE t.deleted_at IS NULL AND t.created_by_id IS NOT NULL
       AND NOT EXISTS (SELECT 1 FROM users u WHERE u.id = t.created_by_id)
    UNION ALL
    SELECT 'subscriptions', count(*) FROM trigger_subscriptions t
     WHERE t.deleted_at IS NULL AND t.created_by_id IS NOT NULL
       AND NOT EXISTS (SELECT 1 FROM users u WHERE u.id = t.created_by_id)
    UNION ALL
    SELECT 'evaluation_runs', count(*) FROM evaluation_runs r
     WHERE r.deleted_at IS NULL AND r.created_by_id IS NOT NULL
       AND NOT EXISTS (SELECT 1 FROM users u WHERE u.id = r.created_by_id);

    -- triggers that stay environment-bound (artifact_id NULL)
    SELECT 'schedules', count(*) FROM trigger_schedules t
     WHERE t.deleted_at IS NULL AND EXISTS (
       SELECT 1 FROM jsonb_object_keys(COALESCE((t.data::jsonb)->'references', '{}'))
       AS k(key) WHERE k.key = 'environment' OR k.key LIKE 'environment\\_%')
    UNION ALL
    SELECT 'subscriptions', count(*) FROM trigger_subscriptions t
     WHERE t.deleted_at IS NULL AND EXISTS (
       SELECT 1 FROM jsonb_object_keys(COALESCE((t.data::jsonb)->'references', '{}'))
       AS k(key) WHERE k.key = 'environment' OR k.key LIKE 'environment\\_%');

    -- queued work cancelled at the deploy (it has no run envelope)
    SELECT 'session_inputs pending', count(*) FROM session_inputs
     WHERE state = 'pending' AND deleted_at IS NULL
    UNION ALL
    SELECT 'session_commands open', count(*) FROM session_commands
     WHERE state IN ('pending', 'claimed') AND kind LIKE 'continue\\_%'
    UNION ALL
    SELECT 'session_interactions pending', count(*) FROM session_interactions
     WHERE status = 'pending' AND deleted_at IS NULL;
"""

from typing import Callable, Dict, Iterator, List, Optional, Sequence, Union

from alembic import op
from sqlalchemy import text

revision: str = "oss000000047"
down_revision: Union[str, None] = "oss000000046"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


BATCH_SIZE = 1000

_PRINCIPAL_TABLES = ("trigger_schedules", "trigger_subscriptions", "evaluation_runs")
_TRIGGER_TABLES = ("trigger_schedules", "trigger_subscriptions")

# The primary key of the three tables is (project_id, id). Each batch walks it from the
# last key of the previous batch, so a batch that changes nothing still moves forward.
_BATCH_CTE = """
WITH batch AS (
    SELECT project_id, id FROM {table}
    WHERE (project_id, id) > (CAST(:after_project AS uuid), CAST(:after_id AS uuid))
    ORDER BY project_id, id
    LIMIT :batch_size
)
"""

_LAST_KEY = """
SELECT b.project_id, b.id FROM batch b ORDER BY b.project_id DESC, b.id DESC LIMIT 1
"""

# 1. Legacy principal: only rows with a creator and no principal yet.
PRINCIPAL_SQL = (
    _BATCH_CTE
    + """,
changed AS (
    UPDATE {table} t
    SET principal_kind = 'human', principal_id = t.created_by_id
    FROM batch b
    WHERE t.project_id = b.project_id AND t.id = b.id
      AND t.principal_id IS NULL AND t.created_by_id IS NOT NULL
    RETURNING t.id
)
SELECT (SELECT count(*) FROM changed) AS changed, last.project_id, last.id
FROM ("""
    + _LAST_KEY
    + """) last
"""
)

# 2. Pause: live triggers without a principal that are not yet paused for that reason.
# `flags` is JSONB and `meta` is JSON; both can be SQL NULL.
PAUSE_SQL = (
    _BATCH_CTE
    + """,
changed AS (
    UPDATE {table} t
    SET flags = COALESCE(t.flags, '{{}}'::jsonb) || '{{"is_active": false}}'::jsonb,
        meta = (
            COALESCE(t.meta::jsonb, '{{}}'::jsonb)
            || '{{"paused_reason": "missing_principal"}}'::jsonb
        )::json
    FROM batch b
    WHERE t.project_id = b.project_id AND t.id = b.id
      AND t.principal_id IS NULL AND t.deleted_at IS NULL
      AND (
          COALESCE((t.flags->>'is_active')::boolean, true)
          OR (t.meta::jsonb->>'paused_reason') IS DISTINCT FROM 'missing_principal'
      )
    RETURNING t.id
)
SELECT (SELECT array_agg(id) FROM changed) AS changed, last.project_id, last.id
FROM ("""
    + _LAST_KEY
    + """) last
"""
)


def _artifact_candidates() -> str:
    """First match, in order, for each prefix: `{prefix}.id`, `{prefix}.slug`,
    `{prefix}_variant.id`, `{prefix}_variant.slug`, `{prefix}_revision.id`. Every
    lookup is scoped by the trigger's project; an id of another project matches
    nothing."""

    uuid_pattern = "'^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'"

    def _id(path: str) -> str:
        return (
            f"CASE WHEN (r.refs #>> '{{{path}}}') ~ {uuid_pattern} "
            f"THEN CAST(r.refs #>> '{{{path}}}' AS uuid) END"
        )

    parts: List[str] = []
    for prefix in ("application", "evaluator", "workflow"):
        parts.extend(
            [
                f"""(SELECT a.id FROM workflow_artifacts a
                     WHERE a.project_id = r.project_id
                       AND a.id = {_id(f"{prefix},id")})""",
                f"""(SELECT a.id FROM workflow_artifacts a
                     WHERE a.project_id = r.project_id
                       AND a.slug = (r.refs #>> '{{{prefix},slug}}')
                     ORDER BY a.deleted_at NULLS FIRST, a.created_at LIMIT 1)""",
                f"""(SELECT v.artifact_id FROM workflow_variants v
                     WHERE v.project_id = r.project_id
                       AND v.id = {_id(f"{prefix}_variant,id")})""",
                f"""(SELECT v.artifact_id FROM workflow_variants v
                     WHERE v.project_id = r.project_id
                       AND v.slug = (r.refs #>> '{{{prefix}_variant,slug}}')
                     ORDER BY v.deleted_at NULLS FIRST, v.created_at LIMIT 1)""",
                f"""(SELECT w.artifact_id FROM workflow_revisions w
                     WHERE w.project_id = r.project_id
                       AND w.id = {_id(f"{prefix}_revision,id")})""",
            ]
        )
    return "COALESCE(\n" + ",\n".join(parts) + "\n)"


# 3. Target agent: only rows whose artifact_id is NULL; an environment reference wins
# over every direct reference and leaves the row NULL.
ARTIFACT_SQL = (
    _BATCH_CTE
    + """,
rows AS (
    SELECT t.project_id, t.id,
           COALESCE((t.data::jsonb)->'references', '{{}}'::jsonb) AS refs
    FROM {table} t
    JOIN batch b ON t.project_id = b.project_id AND t.id = b.id
    WHERE t.artifact_id IS NULL
),
direct AS (
    SELECT r.project_id, r.id, r.refs FROM rows r
    WHERE jsonb_typeof(r.refs) = 'object'
      AND NOT EXISTS (
          SELECT 1 FROM jsonb_object_keys(r.refs) AS k(key)
          WHERE k.key = 'environment' OR k.key LIKE 'environment\\_%'
      )
),
resolved AS (
    SELECT r.project_id, r.id, """
    + _artifact_candidates().replace("{", "{{").replace("}", "}}")
    + """ AS artifact_id
    FROM direct r
),
changed AS (
    UPDATE {table} t
    SET artifact_id = x.artifact_id
    FROM resolved x
    WHERE t.project_id = x.project_id AND t.id = x.id
      AND x.artifact_id IS NOT NULL AND t.artifact_id IS NULL
    RETURNING t.id
)
SELECT (SELECT count(*) FROM changed) AS changed, last.project_id, last.id
FROM ("""
    + _LAST_KEY
    + """) last
"""
)

_START_KEY = {
    "after_project": "00000000-0000-0000-0000-000000000000",
    "after_id": "00000000-0000-0000-0000-000000000000",
}


def _walk(connection, sql: str, *, batch_size: int) -> Iterator:
    """Run `sql` batch after batch until the walk passes the last key. Yields the
    `changed` value of each batch as it runs, so memory stays one batch."""

    key = dict(_START_KEY)
    while True:
        row = connection.execute(text(sql), {**key, "batch_size": batch_size}).first()
        if row is None:  # the batch was empty: past the last key
            return
        yield row.changed
        key = {"after_project": str(row.project_id), "after_id": str(row.id)}


def _backfill(
    connection,
    *,
    batch_size: int = BATCH_SIZE,
    report: Optional[Callable[[str], None]] = None,
) -> Dict[str, int]:
    """The three steps on a sync connection. Returns counts only; the ids of paused
    triggers go to `report` (the hook log), never anywhere else."""

    counts = {"principals": 0, "paused": 0, "artifact_ids": 0}

    for table in _PRINCIPAL_TABLES:
        for changed in _walk(
            connection, PRINCIPAL_SQL.format(table=table), batch_size=batch_size
        ):
            counts["principals"] += int(changed or 0)

    for table in _TRIGGER_TABLES:
        for changed in _walk(
            connection, PAUSE_SQL.format(table=table), batch_size=batch_size
        ):
            paused_ids = [str(i) for i in (changed or [])]
            counts["paused"] += len(paused_ids)
            # One line per batch: the log stays bounded by the batch size.
            if report is not None and paused_ids:
                report(
                    f"[run principal] paused {len(paused_ids)} {table} without a "
                    f"principal: {', '.join(paused_ids)}"
                )

    for table in _TRIGGER_TABLES:
        for changed in _walk(
            connection, ARTIFACT_SQL.format(table=table), batch_size=batch_size
        ):
            counts["artifact_ids"] += int(changed or 0)

    return counts


def upgrade() -> None:
    with op.get_context().autocommit_block():
        connection = op.get_bind()
        # Session settings: in the autocommit block every statement below is its own
        # transaction, and each one waits at most 5 s for a lock and runs at most 60 s.
        connection.execute(text("SET lock_timeout = '5s'"))
        connection.execute(text("SET statement_timeout = '60s'"))
        try:
            counts = _backfill(connection, report=print)
        finally:
            connection.execute(text("RESET lock_timeout"))
            connection.execute(text("RESET statement_timeout"))
        print(
            "[run principal] backfill: "
            f"principals={counts['principals']} "
            f"paused={counts['paused']} "
            f"artifact_ids={counts['artifact_ids']}"
        )


def downgrade() -> None:
    pass
