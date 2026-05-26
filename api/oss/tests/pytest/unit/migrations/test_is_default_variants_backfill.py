"""Unit tests for the C1b is_default backfill migration."""

from oss.databases.postgres.migrations.core.data_migrations.is_default_variants import (
    VARIANT_TABLES,
    backfill_sql,
)


def test_covers_all_four_variant_tables():
    assert VARIANT_TABLES == (
        "workflow_variants",
        "query_variants",
        "testset_variants",
        "environment_variants",
    )


def test_backfill_sql_picks_earliest_per_project_and_artifact():
    sql = backfill_sql("workflow_variants")

    assert "DISTINCT ON (project_id, artifact_id)" in sql
    assert "ORDER BY project_id, artifact_id, created_at ASC, id ASC" in sql


def test_backfill_sql_skips_already_flagged_artifacts():
    sql = backfill_sql("workflow_variants")

    assert "already_flagged" in sql
    assert "(flags->>'is_default')::boolean IS TRUE" in sql
    assert "NOT EXISTS" in sql


def test_backfill_sql_uses_jsonb_set_with_coalesce():
    sql = backfill_sql("workflow_variants")

    assert "jsonb_set" in sql
    assert "COALESCE(t.flags, '{}'::jsonb)" in sql
    assert "'true'::jsonb" in sql


def test_backfill_sql_ignores_archived_rows():
    sql = backfill_sql("workflow_variants")

    assert "deleted_at IS NULL" in sql


def test_backfill_sql_is_table_parametrized():
    for table in VARIANT_TABLES:
        sql = backfill_sql(table)
        assert f"UPDATE {table} AS t" in sql
        assert f"FROM {table}" in sql
