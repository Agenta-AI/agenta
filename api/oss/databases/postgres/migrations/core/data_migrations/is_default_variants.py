"""Helpers for the C1b is_default-flag backfill.

Lifted into its own module so the migration-level SQL can be unit-tested
without importing `alembic`, mirroring the workflow_revisions pattern.
"""

from typing import Tuple


VARIANT_TABLES: Tuple[str, ...] = (
    "workflow_variants",
    "query_variants",
    "testset_variants",
    "environment_variants",
)


def backfill_sql(table: str) -> str:
    return f"""
        WITH first_per_artifact AS (
            SELECT DISTINCT ON (project_id, artifact_id) id, project_id
            FROM {table}
            WHERE deleted_at IS NULL
            ORDER BY project_id, artifact_id, created_at ASC, id ASC
        ),
        already_flagged AS (
            SELECT project_id, artifact_id
            FROM {table}
            WHERE (flags->>'is_default')::boolean IS TRUE
        )
        UPDATE {table} AS t
        SET flags = jsonb_set(
            COALESCE(t.flags, '{{}}'::jsonb),
            '{{is_default}}',
            'true'::jsonb,
            true
        )
        FROM first_per_artifact f
        WHERE t.project_id = f.project_id
          AND t.id = f.id
          AND NOT EXISTS (
              SELECT 1 FROM already_flagged a
              WHERE a.project_id = t.project_id
                AND a.artifact_id = t.artifact_id
          )
    """
