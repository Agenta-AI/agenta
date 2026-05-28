import click
from sqlalchemy import Connection, text


def upgrade_retrieval_slug_corruption(session: Connection) -> None:
    """Repair corrupted variant slugs and the references blobs that embed them.

    Some workflow_variants.slug values contain whitespace or other characters
    outside the allowed slug alphabet ([a-zA-Z0-9_.-]). On retrieval, the slug
    is parsed/validated and these corrupted values break resolution. The same
    corrupted slug is also embedded inside environment_revisions.data under
    references[*].application_variant.slug, so both must be repaired.

    Both repairs replace disallowed characters with '_' via the same regexp,
    keeping the variant table and the embedded references blob in sync.
    """

    variants_result = session.execute(
        text(
            r"""
            UPDATE workflow_variants
            SET slug = regexp_replace(slug, '[^a-zA-Z0-9_.\-]', '_', 'g')
            WHERE slug !~ '^[a-zA-Z0-9_\-][a-zA-Z0-9_.\-]*$'
            """
        )
    )

    click.echo(
        click.style(
            f"Repaired {variants_result.rowcount} corrupted workflow_variants.slug rows",
            fg="green",
        ),
        color=True,
    )

    references_result = session.execute(
        text(
            r"""
            UPDATE environment_revisions er
            SET data = jsonb_set(
                er.data::jsonb,
                '{references}',
                (
                    SELECT jsonb_object_agg(
                        ref.key,
                        CASE
                            WHEN ref.value -> 'application_variant' ->> 'slug'
                                 !~ '^[a-zA-Z0-9_\-][a-zA-Z0-9_.\-]*$'
                            THEN jsonb_set(
                                ref.value,
                                '{application_variant,slug}',
                                to_jsonb(regexp_replace(ref.value -> 'application_variant' ->> 'slug', '[^a-zA-Z0-9_.\-]', '_', 'g'))
                            )
                            ELSE ref.value
                        END
                    )
                    FROM jsonb_each(er.data::jsonb -> 'references') AS ref
                )
            )::json
            WHERE er.data IS NOT NULL
              AND jsonb_typeof(er.data::jsonb) = 'object'
              AND EXISTS (
                SELECT 1
                FROM jsonb_each(er.data::jsonb -> 'references') AS ref
                WHERE ref.value -> 'application_variant' ->> 'slug'
                      !~ '^[a-zA-Z0-9_\-][a-zA-Z0-9_.\-]*$'
              )
            """
        )
    )

    click.echo(
        click.style(
            f"Repaired {references_result.rowcount} environment_revisions.data references rows",
            fg="green",
        ),
        color=True,
    )


def downgrade_retrieval_slug_corruption(session: Connection) -> None:
    """Downgrade is not supported.

    This migration destructively rewrites corrupted slugs (and the slugs
    embedded in environment_revisions.data references). The original values
    cannot be restored.
    """

    raise NotImplementedError(
        "Downgrade is not supported: this migration destructively repairs "
        "corrupted variant slugs and embedded references slugs. Restore from "
        "backup if needed."
    )
