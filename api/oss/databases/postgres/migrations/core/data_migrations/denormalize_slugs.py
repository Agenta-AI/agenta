"""Helpers for the C1.1b parent-slug denormalization backfill.

Lifted into its own module so the migration-level SQL can be unit-tested
without importing `alembic`. C1.1b denormalizes `artifact_slug` onto
variant rows and `artifact_slug` + `variant_slug` onto revision rows
across the four git-pattern entity tables so read paths can skip the
join load.
"""

from typing import Tuple


ENTITIES: Tuple[Tuple[str, str, str], ...] = (
    ("workflow_artifacts", "workflow_variants", "workflow_revisions"),
    ("query_artifacts", "query_variants", "query_revisions"),
    ("testset_artifacts", "testset_variants", "testset_revisions"),
    ("environment_artifacts", "environment_variants", "environment_revisions"),
)


def variant_backfill_sql(*, variants: str, artifacts: str) -> str:
    return f"""
        UPDATE {variants} AS v
        SET artifact_slug = a.slug
        FROM {artifacts} AS a
        WHERE v.project_id = a.project_id
          AND v.artifact_id = a.id
          AND v.artifact_slug IS DISTINCT FROM a.slug
    """


def revision_backfill_sql(*, revisions: str, variants: str) -> str:
    return f"""
        UPDATE {revisions} AS r
        SET artifact_slug = v.artifact_slug,
            variant_slug = v.slug
        FROM {variants} AS v
        WHERE r.project_id = v.project_id
          AND r.variant_id = v.id
          AND (
              r.artifact_slug IS DISTINCT FROM v.artifact_slug
              OR r.variant_slug IS DISTINCT FROM v.slug
          )
    """
