"""Unit tests for the C1.1b parent-slug denormalization migration."""

from oss.databases.postgres.migrations.core.data_migrations.denormalize_slugs import (
    ENTITIES,
    revision_backfill_sql,
    variant_backfill_sql,
)


def test_covers_four_entity_sets():
    assert ENTITIES == (
        ("workflow_artifacts", "workflow_variants", "workflow_revisions"),
        ("query_artifacts", "query_variants", "query_revisions"),
        ("testset_artifacts", "testset_variants", "testset_revisions"),
        (
            "environment_artifacts",
            "environment_variants",
            "environment_revisions",
        ),
    )


def test_variant_backfill_joins_on_project_id_and_artifact_id():
    sql = variant_backfill_sql(
        variants="workflow_variants",
        artifacts="workflow_artifacts",
    )

    assert "UPDATE workflow_variants AS v" in sql
    assert "FROM workflow_artifacts AS a" in sql
    assert "v.project_id = a.project_id" in sql
    assert "v.artifact_id = a.id" in sql


def test_variant_backfill_is_idempotent():
    sql = variant_backfill_sql(
        variants="workflow_variants",
        artifacts="workflow_artifacts",
    )

    assert "v.artifact_slug IS DISTINCT FROM a.slug" in sql


def test_revision_backfill_copies_both_slugs_from_variant():
    sql = revision_backfill_sql(
        revisions="workflow_revisions",
        variants="workflow_variants",
    )

    assert "SET artifact_slug = v.artifact_slug" in sql
    assert "variant_slug = v.slug" in sql
    assert "r.project_id = v.project_id" in sql
    assert "r.variant_id = v.id" in sql


def test_revision_backfill_is_idempotent():
    sql = revision_backfill_sql(
        revisions="workflow_revisions",
        variants="workflow_variants",
    )

    assert "r.artifact_slug IS DISTINCT FROM v.artifact_slug" in sql
    assert "r.variant_slug IS DISTINCT FROM v.slug" in sql


def test_backfill_sql_is_table_parametrized():
    for artifacts, variants, revisions in ENTITIES:
        v_sql = variant_backfill_sql(variants=variants, artifacts=artifacts)
        assert f"UPDATE {variants} AS v" in v_sql
        assert f"FROM {artifacts} AS a" in v_sql

        r_sql = revision_backfill_sql(revisions=revisions, variants=variants)
        assert f"UPDATE {revisions} AS r" in r_sql
        assert f"FROM {variants} AS v" in r_sql
