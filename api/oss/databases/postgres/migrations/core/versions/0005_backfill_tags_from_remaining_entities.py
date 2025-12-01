"""backfill tags table from testsets, queries, and evaluations

Revision ID: 0005_backfill_remaining
Revises: 0004_attach_remaining_triggers
Create Date: 2025-11-27 11:15:00.000000

"""

from typing import Sequence, Union

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "0005_backfill_remaining"
down_revision: Union[str, None] = "0004_attach_remaining_triggers"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # TESTSETS ==============================================================

    # Backfill tags from testset_artifacts
    op.execute("""
    INSERT INTO tags(project_id, kind, key)
    SELECT DISTINCT project_id, 'testset'::text, key
    FROM testset_artifacts
    CROSS JOIN LATERAL jsonb_object_keys(tags) AS key
    WHERE tags IS NOT NULL
    ON CONFLICT (project_id, kind, key) DO NOTHING;
    """)

    # Backfill tags from testset_variants
    op.execute("""
    INSERT INTO tags(project_id, kind, key)
    SELECT DISTINCT project_id, 'testset'::text, key
    FROM testset_variants
    CROSS JOIN LATERAL jsonb_object_keys(tags) AS key
    WHERE tags IS NOT NULL
    ON CONFLICT (project_id, kind, key) DO NOTHING;
    """)

    # Backfill tags from testset_revisions
    op.execute("""
    INSERT INTO tags(project_id, kind, key)
    SELECT DISTINCT project_id, 'testset'::text, key
    FROM testset_revisions
    CROSS JOIN LATERAL jsonb_object_keys(tags) AS key
    WHERE tags IS NOT NULL
    ON CONFLICT (project_id, kind, key) DO NOTHING;
    """)

    # QUERIES ================================================================

    # Backfill tags from query_artifacts
    op.execute("""
    INSERT INTO tags(project_id, kind, key)
    SELECT DISTINCT project_id, 'query'::text, key
    FROM query_artifacts
    CROSS JOIN LATERAL jsonb_object_keys(tags) AS key
    WHERE tags IS NOT NULL
    ON CONFLICT (project_id, kind, key) DO NOTHING;
    """)

    # Backfill tags from query_variants
    op.execute("""
    INSERT INTO tags(project_id, kind, key)
    SELECT DISTINCT project_id, 'query'::text, key
    FROM query_variants
    CROSS JOIN LATERAL jsonb_object_keys(tags) AS key
    WHERE tags IS NOT NULL
    ON CONFLICT (project_id, kind, key) DO NOTHING;
    """)

    # Backfill tags from query_revisions
    op.execute("""
    INSERT INTO tags(project_id, kind, key)
    SELECT DISTINCT project_id, 'query'::text, key
    FROM query_revisions
    CROSS JOIN LATERAL jsonb_object_keys(tags) AS key
    WHERE tags IS NOT NULL
    ON CONFLICT (project_id, kind, key) DO NOTHING;
    """)

    # EVALUATIONS ===========================================================

    # Backfill tags from evaluation_runs
    op.execute("""
    INSERT INTO tags(project_id, kind, key)
    SELECT DISTINCT project_id, 'evaluation_run'::text, key
    FROM evaluation_runs
    CROSS JOIN LATERAL jsonb_object_keys(tags) AS key
    WHERE tags IS NOT NULL
    ON CONFLICT (project_id, kind, key) DO NOTHING;
    """)

    # Backfill tags from evaluation_scenarios
    op.execute("""
    INSERT INTO tags(project_id, kind, key)
    SELECT DISTINCT project_id, 'evaluation_scenario'::text, key
    FROM evaluation_scenarios
    CROSS JOIN LATERAL jsonb_object_keys(tags) AS key
    WHERE tags IS NOT NULL
    ON CONFLICT (project_id, kind, key) DO NOTHING;
    """)

    # Backfill tags from evaluation_results
    op.execute("""
    INSERT INTO tags(project_id, kind, key)
    SELECT DISTINCT project_id, 'evaluation_result'::text, key
    FROM evaluation_results
    CROSS JOIN LATERAL jsonb_object_keys(tags) AS key
    WHERE tags IS NOT NULL
    ON CONFLICT (project_id, kind, key) DO NOTHING;
    """)

    # Backfill tags from evaluation_metrics
    op.execute("""
    INSERT INTO tags(project_id, kind, key)
    SELECT DISTINCT project_id, 'evaluation_metrics'::text, key
    FROM evaluation_metrics
    CROSS JOIN LATERAL jsonb_object_keys(tags) AS key
    WHERE tags IS NOT NULL
    ON CONFLICT (project_id, kind, key) DO NOTHING;
    """)

    # Backfill tags from evaluation_queues
    op.execute("""
    INSERT INTO tags(project_id, kind, key)
    SELECT DISTINCT project_id, 'evaluation_queue'::text, key
    FROM evaluation_queues
    CROSS JOIN LATERAL jsonb_object_keys(tags) AS key
    WHERE tags IS NOT NULL
    ON CONFLICT (project_id, kind, key) DO NOTHING;
    """)


def downgrade() -> None:
    # Remove backfilled tags for all entities (except workflows already done)
    op.execute("DELETE FROM tags WHERE kind IN ('testset', 'query', 'evaluation_run', 'evaluation_scenario', 'evaluation_result', 'evaluation_metrics', 'evaluation_queue');")
