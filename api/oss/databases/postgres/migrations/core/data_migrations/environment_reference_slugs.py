import click
from sqlalchemy import Connection, text


def upgrade_environment_reference_slugs(session: Connection) -> None:
    """Backfill stale slugs embedded in environment_revisions.data.references.

    Environment revisions store, per deployment key, a references map with up to
    three levels for one app family::

        {
            "<app>.revision": {
                "application":          Reference(id, slug, version),
                "application_variant":  Reference(id, slug, version),
                "application_revision": Reference(id, slug, version),
            }
        }

    (or the ``workflow``/``workflow_variant``/``workflow_revision`` family).

    Some write paths persisted the bare entity *name* ("My App", "default") or
    the wrong slug at the artifact/variant levels, which breaks the retrieve
    consistency check. The one value the deploy path always writes reliably is
    the *revision id* — it is a real id, never a name.

    So this anchors on the revision id and repopulates all three levels from a
    single authoritative lineage: workflow_revisions (by id) -> its
    workflow_variants row (by variant_id) -> its workflow_artifacts row (by
    artifact_id). Rewriting all three from one revision row guarantees the
    levels stay mutually consistent, not just individually valid. Ref groups
    whose revision id does not resolve are left untouched. `data` is a JSON (not
    JSONB) column, so it is cast to jsonb for manipulation and written back as
    json.
    """

    result = session.execute(
        text(
            r"""
            UPDATE environment_revisions er
            SET data = (
                jsonb_set(
                    er.data::jsonb,
                    '{references}',
                    (
                        SELECT jsonb_object_agg(k.key, lineage.refs)
                        FROM jsonb_each(er.data::jsonb -> 'references') AS k(key, refs)
                        CROSS JOIN LATERAL (
                            -- The per-key prefix is "application" or "workflow".
                            -- Both families share the same {<prefix>,
                            -- <prefix>_variant, <prefix>_revision} shape, so we
                            -- detect it from whichever revision ref is present.
                            SELECT CASE
                                WHEN k.refs ? 'application_revision' THEN 'application'
                                WHEN k.refs ? 'workflow_revision' THEN 'workflow'
                                ELSE NULL
                            END AS prefix
                        ) AS p
                        CROSS JOIN LATERAL (
                            -- Resolve the authoritative slugs from the revision
                            -- lineage. NULL row_* (unresolved id / no prefix)
                            -- leaves the refs untouched.
                            SELECT a.slug AS artifact_slug,
                                   v.slug AS variant_slug,
                                   r.slug AS revision_slug
                            FROM workflow_revisions r
                            JOIN workflow_variants v ON v.id = r.variant_id
                            JOIN workflow_artifacts a ON a.id = r.artifact_id
                            WHERE p.prefix IS NOT NULL
                              AND r.id::text
                                  = k.refs -> (p.prefix || '_revision') ->> 'id'
                        ) AS s ON true
                        CROSS JOIN LATERAL (
                            SELECT CASE
                                WHEN p.prefix IS NULL OR s.revision_slug IS NULL
                                THEN k.refs
                                ELSE (
                                    SELECT jsonb_object_agg(
                                        rt.ref_type,
                                        CASE
                                            WHEN NOT (k.refs -> rt.ref_type ? 'slug')
                                            THEN k.refs -> rt.ref_type
                                            WHEN rt.ref_type = p.prefix
                                            THEN jsonb_set(
                                                k.refs -> rt.ref_type,
                                                '{slug}',
                                                to_jsonb(s.artifact_slug)
                                            )
                                            WHEN rt.ref_type = p.prefix || '_variant'
                                            THEN jsonb_set(
                                                k.refs -> rt.ref_type,
                                                '{slug}',
                                                to_jsonb(s.variant_slug)
                                            )
                                            WHEN rt.ref_type = p.prefix || '_revision'
                                            THEN jsonb_set(
                                                k.refs -> rt.ref_type,
                                                '{slug}',
                                                to_jsonb(s.revision_slug)
                                            )
                                            ELSE k.refs -> rt.ref_type
                                        END
                                    )
                                    FROM jsonb_object_keys(k.refs) AS rt(ref_type)
                                )
                            END AS refs
                        ) AS lineage
                    )
                )
            )::json
            WHERE er.deleted_at IS NULL
              AND er.data IS NOT NULL
              AND jsonb_typeof(er.data::jsonb) = 'object'
              AND er.data::jsonb ? 'references'
              AND EXISTS (
                SELECT 1
                FROM jsonb_each(er.data::jsonb -> 'references') AS k(key, refs)
                CROSS JOIN LATERAL (
                    SELECT CASE
                        WHEN k.refs ? 'application_revision' THEN 'application'
                        WHEN k.refs ? 'workflow_revision' THEN 'workflow'
                        ELSE NULL
                    END AS prefix
                ) AS p
                JOIN workflow_revisions r
                    ON p.prefix IS NOT NULL
                   AND r.id::text = k.refs -> (p.prefix || '_revision') ->> 'id'
                JOIN workflow_variants v ON v.id = r.variant_id
                JOIN workflow_artifacts a ON a.id = r.artifact_id
                WHERE (
                        k.refs -> p.prefix ? 'slug'
                        AND k.refs -> p.prefix ->> 'slug' <> a.slug
                    )
                   OR (
                        k.refs -> (p.prefix || '_variant') ? 'slug'
                        AND k.refs -> (p.prefix || '_variant') ->> 'slug' <> v.slug
                    )
                   OR (
                        k.refs -> (p.prefix || '_revision') ? 'slug'
                        AND k.refs -> (p.prefix || '_revision') ->> 'slug' <> r.slug
                    )
              )
            """
        )
    )

    click.echo(
        click.style(
            f"Backfilled embedded slugs in {result.rowcount} environment_revisions.data rows",
            fg="green",
        ),
        color=True,
    )


def downgrade_environment_reference_slugs(session: Connection) -> None:
    """Downgrade is not supported.

    This migration destructively rewrites embedded slugs to match the resolved
    revision lineage. The original (corrupted) values cannot be restored.
    """

    raise NotImplementedError(
        "Downgrade is not supported: this migration destructively backfills "
        "embedded slugs in environment_revisions.data references. "
        "Restore from backup if needed."
    )
