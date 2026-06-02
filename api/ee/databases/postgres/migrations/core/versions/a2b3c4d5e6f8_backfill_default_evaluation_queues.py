"""backfill default evaluation queues

Revision ID: a2b3c4d5e6f8
Revises: a1d2e3f4a5b6
Create Date: 2026-05-15 00:10:00

Backfills source-family flags (`has_traces` / `has_testcases` / `has_queries` /
`has_testsets`) to match the runtime derivation rule, then mass-creates default
queues per the runtime policy and recomputes `is_queue`. The query/testset
recompute keys on exact reference-key presence, not a substring match.

Performance shape: runs are processed in keyset-paginated chunks (by
`evaluation_runs.id`). For each chunk a single COMPUTE select does the heavy
`jsonb_array_elements` step scan and the per-run default-queue existence check
ONCE (no correlated `EXISTS`/`JOIN` re-evaluated per written row). Python then
decides per run what to do, and the writes are cheap set-based `unnest` updates
keyed by id — no subqueries in the mutation path. Every step is idempotent (the
flag rebuild is deterministic; runs that already have a default queue are not
re-created), so a re-run is safe.
"""

import json
from typing import List, Sequence, Union

import click
import sqlalchemy as sa
from alembic import op
from sqlalchemy.engine import Connection

revision: str = "a2b3c4d5e6f8"
down_revision: Union[str, None] = "a1d2e3f4a5b6"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

BATCH_SIZE = 100


# Keyset pagination over run ids. id > cursor with ORDER BY id is index-friendly
# (id is part of the PK) and stable; LIMIT bounds each chunk. Compared as text so
# the cursor is a plain string seeded as "" below every UUID.
_NEXT_RUN_IDS = sa.text("""
    SELECT id::text
    FROM evaluation_runs
    WHERE id::text > :cursor
    ORDER BY id::text
    LIMIT :batch
""")

# One heavy pass per chunk. Derives the source-family flags from the run's steps
# (the `jsonb_array_elements` scan that mirrors dbs/postgres/evaluations/utils.py)
# and, via a single LEFT JOIN over the chunk's runs, reports whether each run
# already has a default queue (any state) and an ACTIVE default queue. Direct
# sources (`has_traces`/`has_testcases`) come from the exact step key on a
# reference-less input; reference-backed sources (`has_queries`/`has_testsets`)
# from exact-key presence (JSONB `?`), not a substring match that would misfire
# on `query_anchor` / `testset_metadata`.
_COMPUTE_CHUNK = sa.text("""
    SELECT
        r.id::text                                              AS run_id,
        r.project_id::text                                      AS project_id,
        r.created_by_id::text                                   AS created_by_id,
        COALESCE(r.status, 'running')                           AS status,
        COALESCE((r.flags ->> 'has_human')::boolean, false)     AS has_human,
        EXISTS (
            SELECT 1
            FROM jsonb_array_elements(COALESCE(r.data::jsonb -> 'steps', '[]'::jsonb)) AS step
            WHERE step ->> 'type' = 'input'
              AND COALESCE(step -> 'references', '{}'::jsonb) = '{}'::jsonb
              AND lower(COALESCE(step ->> 'key', '')) IN ('traces', 'query-direct')
        )                                                       AS has_traces,
        EXISTS (
            SELECT 1
            FROM jsonb_array_elements(COALESCE(r.data::jsonb -> 'steps', '[]'::jsonb)) AS step
            WHERE step ->> 'type' = 'input'
              AND COALESCE(step -> 'references', '{}'::jsonb) = '{}'::jsonb
              AND lower(COALESCE(step ->> 'key', '')) IN ('testcases', 'testset-direct')
        )                                                       AS has_testcases,
        EXISTS (
            SELECT 1
            FROM jsonb_array_elements(COALESCE(r.data::jsonb -> 'steps', '[]'::jsonb)) AS step
            WHERE step ->> 'type' = 'input'
              AND COALESCE(step -> 'references', '{}'::jsonb) ? 'query_revision'
        )                                                       AS has_queries,
        EXISTS (
            SELECT 1
            FROM jsonb_array_elements(COALESCE(r.data::jsonb -> 'steps', '[]'::jsonb)) AS step
            WHERE step ->> 'type' = 'input'
              AND COALESCE(step -> 'references', '{}'::jsonb) ? 'testset_revision'
        )                                                       AS has_testsets,
        bool_or((q.flags ->> 'is_default')::boolean)            AS has_any_default,
        bool_or(
            (q.flags ->> 'is_default')::boolean AND q.deleted_at IS NULL
        )                                                       AS has_active_default
    FROM evaluation_runs r
    LEFT JOIN evaluation_queues q
        ON q.project_id = r.project_id
       AND q.run_id = r.id
    WHERE r.id = ANY(CAST(:ids AS uuid[]))
    GROUP BY r.id, r.project_id, r.created_by_id, r.status, r.flags
""")

# Cheap set-based flag write: merge the precomputed flag object onto each run by
# id. No subqueries; `unnest` pairs each id with its jsonb patch.
_APPLY_FLAGS = sa.text("""
    UPDATE evaluation_runs r
    SET flags = COALESCE(r.flags, '{}'::jsonb) || patch.flags::jsonb
    FROM unnest(
        CAST(:ids AS uuid[]),
        CAST(:flags AS jsonb[])
    ) AS patch(id, flags)
    WHERE r.id = patch.id
""")

# Cheap create: one row per run id that needs a default queue (computed in
# Python — has_human and no existing default). No NOT EXISTS in the write path.
_CREATE_DEFAULT_QUEUES = sa.text("""
    INSERT INTO evaluation_queues (
        project_id,
        id,
        created_at,
        created_by_id,
        flags,
        data,
        status,
        run_id
    )
    SELECT
        CAST(src.project_id AS uuid),
        gen_random_uuid(),
        CURRENT_TIMESTAMP,
        CAST(src.created_by_id AS uuid),
        jsonb_build_object('is_default', true, 'is_sequential', false),
        '{}'::json,
        src.status,
        CAST(src.run_id AS uuid)
    FROM unnest(
        CAST(:project_ids AS text[]),
        CAST(:run_ids AS text[]),
        CAST(:created_by_ids AS text[]),
        CAST(:statuses AS text[])
    ) AS src(project_id, run_id, created_by_id, status)
""")

# Cheap archive: flip deleted_at on the active default queue of each run id that
# should no longer have one (computed in Python). Keyed by (project_id, run_id).
_ARCHIVE_STALE_DEFAULT_QUEUES = sa.text("""
    UPDATE evaluation_queues q
    SET deleted_at = CURRENT_TIMESTAMP,
        deleted_by_id = CAST(src.created_by_id AS uuid)
    FROM unnest(
        CAST(:project_ids AS text[]),
        CAST(:run_ids AS text[]),
        CAST(:created_by_ids AS text[])
    ) AS src(project_id, run_id, created_by_id)
    WHERE q.project_id = CAST(src.project_id AS uuid)
      AND q.run_id = CAST(src.run_id AS uuid)
      AND (q.flags ->> 'is_default')::boolean = true
      AND q.deleted_at IS NULL
""")


def _next_run_ids(connection: Connection, *, cursor: str) -> List[str]:
    result = connection.execute(
        _NEXT_RUN_IDS,
        {"cursor": cursor, "batch": BATCH_SIZE},
    )
    return [row[0] for row in result.fetchall()]


def _flags_patch(row) -> str:
    # Build the jsonb patch for a run: the four source-family flags plus the
    # recomputed is_queue, matching the queue state this chunk produces.
    #
    # is_queue is true iff the run has a human step AND ends this chunk with an
    # ACTIVE default queue. Mirroring _reconcile_default_queue and the create
    # guard below:
    #   - human + already-active default        -> active   (is_queue=True)
    #   - human + no default at all              -> created  (is_queue=True)
    #   - human + only an ARCHIVED default       -> not unarchived here -> False
    #                                               (same as the prior migration)
    #   - non-human + active default             -> archived (is_queue=False)
    #   - non-human                              -> no active default (False)
    if row.has_human:
        ends_with_active_default = row.has_active_default or not row.has_any_default
    else:
        ends_with_active_default = False

    return json.dumps(
        {
            "has_traces": bool(row.has_traces),
            "has_testcases": bool(row.has_testcases),
            "has_queries": bool(row.has_queries),
            "has_testsets": bool(row.has_testsets),
            "is_queue": bool(ends_with_active_default),
        }
    )


def upgrade() -> None:
    connection = op.get_bind()

    cursor = ""
    processed = 0
    created = 0
    archived = 0

    while True:
        ids = _next_run_ids(connection, cursor=cursor)
        if not ids:
            break

        rows = connection.execute(_COMPUTE_CHUNK, {"ids": ids}).fetchall()

        flag_ids: List[str] = []
        flag_patches: List[str] = []

        create_projects: List[str] = []
        create_runs: List[str] = []
        create_creators: List[str] = []
        create_statuses: List[str] = []

        archive_projects: List[str] = []
        archive_runs: List[str] = []
        archive_creators: List[str] = []

        for row in rows:
            flag_ids.append(row.run_id)
            flag_patches.append(_flags_patch(row))

            # Mirror _reconcile_default_queue: has_human runs should have a
            # default; create one only when none exists yet.
            if row.has_human and not row.has_any_default:
                create_projects.append(row.project_id)
                create_runs.append(row.run_id)
                create_creators.append(row.created_by_id)
                create_statuses.append(row.status)

            # Non-human runs with a stale active default get it archived.
            if not row.has_human and row.has_active_default:
                archive_projects.append(row.project_id)
                archive_runs.append(row.run_id)
                archive_creators.append(row.created_by_id)

        # Create/archive first so the flag write's is_queue (computed in Python
        # from the same decisions) matches the resulting queue state.
        if create_runs:
            connection.execute(
                _CREATE_DEFAULT_QUEUES,
                {
                    "project_ids": create_projects,
                    "run_ids": create_runs,
                    "created_by_ids": create_creators,
                    "statuses": create_statuses,
                },
            )
            created += len(create_runs)

        if archive_runs:
            connection.execute(
                _ARCHIVE_STALE_DEFAULT_QUEUES,
                {
                    "project_ids": archive_projects,
                    "run_ids": archive_runs,
                    "created_by_ids": archive_creators,
                },
            )
            archived += len(archive_runs)

        connection.execute(
            _APPLY_FLAGS,
            {"ids": flag_ids, "flags": flag_patches},
        )

        processed += len(ids)
        cursor = ids[-1]

        click.echo(
            f"[default-queue backfill] processed_runs={processed} "
            f"batch={len(ids)} created={created} archived={archived}"
        )

    click.echo(
        f"[default-queue backfill] done processed_runs={processed} "
        f"created={created} archived={archived}"
    )


def downgrade() -> None:
    # Keep generated queues/results intact on downgrade. Remove only the newly
    # inferred flags; old is_queue semantics cannot be reconstructed safely.
    op.execute("""
        UPDATE evaluation_runs
        SET flags = COALESCE(flags, '{}'::jsonb) - 'has_traces' - 'has_testcases'
    """)
