"""backfill default evaluation queues

Revision ID: a2b3c4d5e6f8
Revises: a1d2e3f4a5b6
Create Date: 2026-05-15 00:10:00

Backfills source-family flags (`has_traces` / `has_testcases` / `has_queries` /
`has_testsets`) to match the runtime derivation rule, then mass-creates default
queues per the runtime policy and recomputes `is_queue`. The query/testset
recompute keys on exact reference-key presence, not a substring match.
"""

from typing import Sequence, Union

from alembic import op

revision: str = "a2b3c4d5e6f8"
down_revision: Union[str, None] = "a1d2e3f4a5b6"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Backfill source-family flags to match the runtime derivation rule in
    # dbs/postgres/evaluations/utils.py. `data` is a `json` column, so cast to
    # jsonb before navigating. Direct sources (`has_traces`/`has_testcases`) come
    # from the exact step key on a reference-less input; reference-backed sources
    # (`has_queries`/`has_testsets`) from exact-key presence (JSONB `?`), not a
    # substring match that would misfire on `query_anchor` / `testset_metadata`.
    op.execute("""
        UPDATE evaluation_runs
        SET flags = COALESCE(flags, '{}'::jsonb)
            || jsonb_build_object(
                'has_traces', EXISTS (
                    SELECT 1
                    FROM jsonb_array_elements(COALESCE(data::jsonb -> 'steps', '[]'::jsonb)) AS step
                    WHERE step ->> 'type' = 'input'
                      AND COALESCE(step -> 'references', '{}'::jsonb) = '{}'::jsonb
                      AND lower(COALESCE(step ->> 'key', '')) IN ('traces', 'query-direct')
                ),
                'has_testcases', EXISTS (
                    SELECT 1
                    FROM jsonb_array_elements(COALESCE(data::jsonb -> 'steps', '[]'::jsonb)) AS step
                    WHERE step ->> 'type' = 'input'
                      AND COALESCE(step -> 'references', '{}'::jsonb) = '{}'::jsonb
                      AND lower(COALESCE(step ->> 'key', '')) IN ('testcases', 'testset-direct')
                ),
                'has_queries', EXISTS (
                    SELECT 1
                    FROM jsonb_array_elements(COALESCE(data::jsonb -> 'steps', '[]'::jsonb)) AS step
                    WHERE step ->> 'type' = 'input'
                      AND COALESCE(step -> 'references', '{}'::jsonb) ? 'query_revision'
                ),
                'has_testsets', EXISTS (
                    SELECT 1
                    FROM jsonb_array_elements(COALESCE(data::jsonb -> 'steps', '[]'::jsonb)) AS step
                    WHERE step ->> 'type' = 'input'
                      AND COALESCE(step -> 'references', '{}'::jsonb) ? 'testset_revision'
                )
            )
    """)

    # Mass-create default queues, mirroring the runtime create policy in
    # EvaluationsService._reconcile_default_queue: a default queue should exist
    # only for runs that should have one. The runtime predicate is
    # `EVALUATIONS_DEFAULT_QUEUES_FOR_ALL_RUNS or has_human`, with the env toggle
    # currently hardcoded False, so the backfill condition is `has_human = true`.
    # Existing default queues, active or archived, are preserved and block
    # duplicates. The created queue carries the run's own status instead of a
    # hardcoded 'running', so closed/successful runs are not misrepresented.
    op.execute("""
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
            r.project_id,
            gen_random_uuid(),
            CURRENT_TIMESTAMP,
            r.created_by_id,
            jsonb_build_object('is_default', true, 'is_sequential', false),
            '{}'::json,
            COALESCE(r.status, 'running'),
            r.id
        FROM evaluation_runs r
        WHERE COALESCE((r.flags ->> 'has_human')::boolean, false) = true
          AND NOT EXISTS (
            SELECT 1
            FROM evaluation_queues q
            WHERE q.project_id = r.project_id
              AND q.run_id = r.id
              AND (q.flags ->> 'is_default')::boolean = true
        )
    """)

    # Reconcile the other direction: runs that should NOT have a default queue
    # (has_human = false under the current policy) but carry a stale active
    # default queue get that queue archived, matching the runtime archive branch
    # in _reconcile_default_queue. This keeps the fleet consistent immediately
    # instead of waiting for the first per-run edit to reconcile.
    op.execute("""
        UPDATE evaluation_queues q
        SET deleted_at = CURRENT_TIMESTAMP,
            deleted_by_id = r.created_by_id
        FROM evaluation_runs r
        WHERE q.project_id = r.project_id
          AND q.run_id = r.id
          AND (q.flags ->> 'is_default')::boolean = true
          AND q.deleted_at IS NULL
          AND COALESCE((r.flags ->> 'has_human')::boolean, false) = false
    """)

    # Recompute simple-queue eligibility under the new meaning. An already
    # existing active default queue is as valid as one inserted above.
    op.execute("""
        UPDATE evaluation_runs r
        SET flags = COALESCE(r.flags, '{}'::jsonb)
            || jsonb_build_object(
                'is_queue',
                COALESCE((r.flags ->> 'has_human')::boolean, false)
                AND EXISTS (
                    SELECT 1
                    FROM evaluation_queues q
                    WHERE q.project_id = r.project_id
                      AND q.run_id = r.id
                      AND (q.flags ->> 'is_default')::boolean = true
                      AND q.deleted_at IS NULL
                )
            )
    """)


def downgrade() -> None:
    # Keep generated queues/results intact on downgrade. Remove only the newly
    # inferred flags; old is_queue semantics cannot be reconstructed safely.
    op.execute("""
        UPDATE evaluation_runs
        SET flags = COALESCE(flags, '{}'::jsonb) - 'has_traces' - 'has_testcases'
    """)
