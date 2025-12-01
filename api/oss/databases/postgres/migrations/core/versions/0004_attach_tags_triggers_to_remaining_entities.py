"""attach tags triggers to testsets, queries, and evaluations

Revision ID: 0004_attach_remaining_triggers
Revises: 0003_backfill_workflows
Create Date: 2025-11-27 11:00:00.000000

"""

from typing import Sequence, Union

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "0004_attach_remaining_triggers"
down_revision: Union[str, None] = "0003_backfill_workflows"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # TESTSETS (3 tables) ====================================================

    # Attach triggers to testset_artifacts
    op.execute("""
    CREATE TRIGGER trg_testset_artifacts_sync_tags
    AFTER INSERT OR UPDATE ON testset_artifacts
    FOR EACH ROW
    EXECUTE FUNCTION sync_tags_from_entity('testset');
    """)

    # Attach triggers to testset_variants
    op.execute("""
    CREATE TRIGGER trg_testset_variants_sync_tags
    AFTER INSERT OR UPDATE ON testset_variants
    FOR EACH ROW
    EXECUTE FUNCTION sync_tags_from_entity('testset');
    """)

    # Attach triggers to testset_revisions
    op.execute("""
    CREATE TRIGGER trg_testset_revisions_sync_tags
    AFTER INSERT OR UPDATE ON testset_revisions
    FOR EACH ROW
    EXECUTE FUNCTION sync_tags_from_entity('testset');
    """)

    # QUERIES (3 tables) ====================================================

    # Attach triggers to query_artifacts
    op.execute("""
    CREATE TRIGGER trg_query_artifacts_sync_tags
    AFTER INSERT OR UPDATE ON query_artifacts
    FOR EACH ROW
    EXECUTE FUNCTION sync_tags_from_entity('query');
    """)

    # Attach triggers to query_variants
    op.execute("""
    CREATE TRIGGER trg_query_variants_sync_tags
    AFTER INSERT OR UPDATE ON query_variants
    FOR EACH ROW
    EXECUTE FUNCTION sync_tags_from_entity('query');
    """)

    # Attach triggers to query_revisions
    op.execute("""
    CREATE TRIGGER trg_query_revisions_sync_tags
    AFTER INSERT OR UPDATE ON query_revisions
    FOR EACH ROW
    EXECUTE FUNCTION sync_tags_from_entity('query');
    """)

    # EVALUATIONS (5 tables) ================================================

    # Attach triggers to evaluation_runs
    op.execute("""
    CREATE TRIGGER trg_evaluation_runs_sync_tags
    AFTER INSERT OR UPDATE ON evaluation_runs
    FOR EACH ROW
    EXECUTE FUNCTION sync_tags_from_entity('evaluation_run');
    """)

    # Attach triggers to evaluation_scenarios
    op.execute("""
    CREATE TRIGGER trg_evaluation_scenarios_sync_tags
    AFTER INSERT OR UPDATE ON evaluation_scenarios
    FOR EACH ROW
    EXECUTE FUNCTION sync_tags_from_entity('evaluation_scenario');
    """)

    # Attach triggers to evaluation_results
    op.execute("""
    CREATE TRIGGER trg_evaluation_results_sync_tags
    AFTER INSERT OR UPDATE ON evaluation_results
    FOR EACH ROW
    EXECUTE FUNCTION sync_tags_from_entity('evaluation_result');
    """)

    # Attach triggers to evaluation_metrics
    op.execute("""
    CREATE TRIGGER trg_evaluation_metrics_sync_tags
    AFTER INSERT OR UPDATE ON evaluation_metrics
    FOR EACH ROW
    EXECUTE FUNCTION sync_tags_from_entity('evaluation_metrics');
    """)

    # Attach triggers to evaluation_queues
    op.execute("""
    CREATE TRIGGER trg_evaluation_queues_sync_tags
    AFTER INSERT OR UPDATE ON evaluation_queues
    FOR EACH ROW
    EXECUTE FUNCTION sync_tags_from_entity('evaluation_queue');
    """)


def downgrade() -> None:
    # Drop triggers in reverse order
    # Evaluations
    op.execute("DROP TRIGGER IF EXISTS trg_evaluation_queues_sync_tags ON evaluation_queues")
    op.execute("DROP TRIGGER IF EXISTS trg_evaluation_metrics_sync_tags ON evaluation_metrics")
    op.execute("DROP TRIGGER IF EXISTS trg_evaluation_results_sync_tags ON evaluation_results")
    op.execute("DROP TRIGGER IF EXISTS trg_evaluation_scenarios_sync_tags ON evaluation_scenarios")
    op.execute("DROP TRIGGER IF EXISTS trg_evaluation_runs_sync_tags ON evaluation_runs")

    # Queries
    op.execute("DROP TRIGGER IF EXISTS trg_query_revisions_sync_tags ON query_revisions")
    op.execute("DROP TRIGGER IF EXISTS trg_query_variants_sync_tags ON query_variants")
    op.execute("DROP TRIGGER IF EXISTS trg_query_artifacts_sync_tags ON query_artifacts")

    # Testsets
    op.execute("DROP TRIGGER IF EXISTS trg_testset_revisions_sync_tags ON testset_revisions")
    op.execute("DROP TRIGGER IF EXISTS trg_testset_variants_sync_tags ON testset_variants")
    op.execute("DROP TRIGGER IF EXISTS trg_testset_artifacts_sync_tags ON testset_artifacts")
