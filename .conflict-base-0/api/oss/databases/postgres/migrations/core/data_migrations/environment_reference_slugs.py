import click
from sqlalchemy import Connection, text

BATCH_SIZE = 100


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

    (or the ``evaluator``/``workflow`` families, which reuse the same workflow_*
    persistence, so one revision-lineage lookup is authoritative for all three).

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

    Rows are processed in batches of BATCH_SIZE, each committed independently,
    so row locks are held only briefly and live traffic is not blocked.
    """

    total = 0
    last_id = None

    while True:
        cursor_clause = "AND er.id > :last_id" if last_id is not None else ""

        batch_ids = session.execute(
            text(
                f"""
                SELECT er.id
                FROM environment_revisions er
                WHERE er.deleted_at IS NULL
                  AND er.data IS NOT NULL
                  AND jsonb_typeof(er.data::jsonb) = 'object'
                  AND er.data::jsonb ? 'references'
                  {cursor_clause}
                ORDER BY er.id
                LIMIT :batch_size
                """
            ),
            {"last_id": last_id, "batch_size": BATCH_SIZE},
        ).fetchall()

        if not batch_ids:
            break

        ids = [row[0] for row in batch_ids]
        last_id = ids[-1]

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
                                SELECT CASE
                                    WHEN k.refs ? 'application_revision' THEN 'application'
                                    WHEN k.refs ? 'evaluator_revision'   THEN 'evaluator'
                                    WHEN k.refs ? 'workflow_revision'    THEN 'workflow'
                                    ELSE NULL
                                END AS prefix
                            ) AS p
                            LEFT JOIN LATERAL (
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
                WHERE er.id = ANY(:ids)
                """
            ),
            {"ids": ids},
        )

        session.commit()
        total += result.rowcount
        click.echo(f"  ... backfilled {total} rows so far")

    click.echo(
        click.style(
            f"Backfilled embedded slugs in {total} environment_revisions.data rows",
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
