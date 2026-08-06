import secrets
import uuid
from datetime import datetime, timedelta
from typing import Any, Optional

import click
from sqlalchemy import Connection, text


BATCH_SIZE = 100


def _uuid7_from_datetime(value: datetime) -> uuid.UUID:
    if value.tzinfo is None:
        raise ValueError("datetime must be timezone-aware")

    timestamp_ms = int(value.timestamp() * 1000)
    if not 0 <= timestamp_ms < (1 << 48):
        raise ValueError("datetime is outside UUIDv7 timestamp range")

    random_a = secrets.randbits(12)
    random_b = secrets.randbits(62)

    return uuid.UUID(
        int=(timestamp_ms << 80 | 0x7 << 76 | random_a << 64 | 0b10 << 62 | random_b)
    )


def _fetch_variants_missing_v0(
    *,
    session: Connection,
    last_variant_id: Optional[str],
    batch_size: int,
) -> list[Any]:
    query = text("""
        WITH missing AS (
            SELECT
                project_id,
                artifact_id,
                variant_id
            FROM workflow_revisions
            WHERE (
                CAST(:last_variant_id AS uuid) IS NULL
                OR variant_id > CAST(:last_variant_id AS uuid)
            )
            GROUP BY project_id, artifact_id, variant_id
            HAVING NOT BOOL_OR(version = '0')
            ORDER BY variant_id
            LIMIT :batch_size
        )
        SELECT
            missing.project_id,
            missing.artifact_id,
            missing.variant_id,
            first_revision.created_at AS first_created_at,
            first_revision.created_by_id,
            first_revision.author,
            first_revision.name,
            first_revision.description
        FROM missing
        JOIN LATERAL (
            SELECT created_at, created_by_id, author, name, description
            FROM workflow_revisions
            WHERE project_id = missing.project_id
              AND variant_id = missing.variant_id
            ORDER BY id ASC
            LIMIT 1
        ) AS first_revision ON true
        ORDER BY missing.variant_id
    """)

    return session.execute(
        query,
        {
            "last_variant_id": last_variant_id,
            "batch_size": batch_size,
        },
    ).fetchall()


def _insert_seed_revision(
    *,
    session: Connection,
    variant: Any,
) -> None:
    query = text("""
        INSERT INTO workflow_revisions (
            project_id,
            artifact_id,
            variant_id,
            id,
            slug,
            version,
            created_at,
            created_by_id,
            name,
            description,
            message,
            author,
            date
        )
        VALUES (
            :project_id,
            :artifact_id,
            :variant_id,
            :id,
            :slug,
            '0',
            :created_at,
            :created_by_id,
            :name,
            :description,
            'Initial commit',
            :author,
            :created_at
        )
    """)

    seed_created_at = variant.first_created_at - timedelta(seconds=1)
    session.execute(
        query,
        {
            "project_id": variant.project_id,
            "artifact_id": variant.artifact_id,
            "variant_id": variant.variant_id,
            "id": _uuid7_from_datetime(seed_created_at),
            "slug": uuid.uuid4().hex[-12:],
            "created_at": seed_created_at,
            "created_by_id": variant.created_by_id,
            "author": variant.author,
            "name": variant.name,
            "description": variant.description,
        },
    )


def _fetch_variants_with_duplicate_versions(
    *,
    session: Connection,
    last_variant_id: Optional[str],
    batch_size: int,
) -> list[Any]:
    query = text("""
        SELECT
            project_id,
            variant_id
        FROM workflow_revisions
        WHERE (
            CAST(:last_variant_id AS uuid) IS NULL
            OR variant_id > CAST(:last_variant_id AS uuid)
        )
        GROUP BY project_id, variant_id
        HAVING COUNT(*) > COUNT(DISTINCT version)
        ORDER BY variant_id
        LIMIT :batch_size
    """)

    return session.execute(
        query,
        {
            "last_variant_id": last_variant_id,
            "batch_size": batch_size,
        },
    ).fetchall()


def _fetch_variant_revisions(
    *,
    session: Connection,
    project_id: Any,
    variant_id: Any,
) -> list[Any]:
    query = text("""
        SELECT id, version
        FROM workflow_revisions
        WHERE project_id = :project_id
          AND variant_id = :variant_id
        ORDER BY id ASC
    """)

    return session.execute(
        query,
        {
            "project_id": project_id,
            "variant_id": variant_id,
        },
    ).fetchall()


def _repair_duplicate_variant_versions(
    *,
    session: Connection,
    variant: Any,
) -> tuple[int, list[dict[str, Any]]]:
    revisions = _fetch_variant_revisions(
        session=session,
        project_id=variant.project_id,
        variant_id=variant.variant_id,
    )
    updates = [
        {"id": revision.id, "version": str(index)}
        for index, revision in enumerate(revisions)
        if revision.version != str(index)
    ]

    if not updates:
        return 0, []

    query = text("""
        UPDATE workflow_revisions
        SET version = :version
        WHERE id = :id
    """)
    session.execute(query, updates)

    return len(updates), [
        {
            "project_id": variant.project_id,
            "revision_id": update["id"],
            "version": update["version"],
        }
        for update in updates
    ]


def _create_revision_version_mapping(
    *,
    session: Connection,
    batch_mapping: list[dict[str, Any]],
) -> None:
    create_query = text("""
        CREATE TEMP TABLE IF NOT EXISTS workflow_revision_version_repair_map (
            project_id uuid NOT NULL,
            revision_id uuid PRIMARY KEY,
            version text NOT NULL
        ) ON COMMIT DROP
    """)
    clear_query = text("""
        DELETE FROM workflow_revision_version_repair_map
    """)
    insert_query = text("""
        INSERT INTO workflow_revision_version_repair_map (
            project_id,
            revision_id,
            version
        )
        VALUES (:project_id, :revision_id, :version)
        ON CONFLICT (revision_id) DO UPDATE SET
            project_id = EXCLUDED.project_id,
            version = EXCLUDED.version
    """)

    session.execute(create_query)
    session.execute(clear_query)
    session.execute(insert_query, batch_mapping)


def _update_environment_references(
    *,
    session: Connection,
    project_id: Any,
) -> int:
    query = text("""
        WITH affected_environment_revisions AS (
            SELECT DISTINCT er.id
            FROM environment_revisions AS er
            CROSS JOIN LATERAL jsonb_each(
                CASE
                    WHEN jsonb_typeof(er.data::jsonb -> 'references') = 'object'
                    THEN er.data::jsonb -> 'references'
                    ELSE '{}'::jsonb
                END
            ) AS ref(key, value)
            CROSS JOIN LATERAL (
                SELECT CASE
                    WHEN ref.value ? 'application_revision' THEN 'application'
                    WHEN ref.value ? 'evaluator_revision' THEN 'evaluator'
                    WHEN ref.value ? 'workflow_revision' THEN 'workflow'
                    ELSE NULL
                END AS prefix
            ) AS reference_type
            JOIN workflow_revision_version_repair_map AS m
              ON reference_type.prefix IS NOT NULL
             AND ref.value
                 #>> ARRAY[reference_type.prefix || '_revision', 'id']
                 = m.revision_id::text
            WHERE er.project_id = :project_id
              AND er.data IS NOT NULL
        ),
        rebuilt_references AS (
            SELECT
                er.id AS environment_revision_id,
                jsonb_object_agg(
                    ref.key,
                    CASE
                        WHEN m.version IS NOT NULL THEN
                            jsonb_set(
                                ref.value,
                                ARRAY[
                                    reference_type.prefix || '_revision',
                                    'version'
                                ],
                                to_jsonb(m.version),
                                true
                            )
                        ELSE ref.value
                    END
                ) AS references
            FROM environment_revisions AS er
            JOIN affected_environment_revisions AS affected
              ON affected.id = er.id
            CROSS JOIN LATERAL jsonb_each(
                CASE
                    WHEN jsonb_typeof(er.data::jsonb -> 'references') = 'object'
                    THEN er.data::jsonb -> 'references'
                    ELSE '{}'::jsonb
                END
            ) AS ref(key, value)
            CROSS JOIN LATERAL (
                SELECT CASE
                    WHEN ref.value ? 'application_revision' THEN 'application'
                    WHEN ref.value ? 'evaluator_revision' THEN 'evaluator'
                    WHEN ref.value ? 'workflow_revision' THEN 'workflow'
                    ELSE NULL
                END AS prefix
            ) AS reference_type
            LEFT JOIN workflow_revision_version_repair_map AS m
              ON reference_type.prefix IS NOT NULL
             AND ref.value
                 #>> ARRAY[reference_type.prefix || '_revision', 'id']
                 = m.revision_id::text
            GROUP BY er.id
        )
        UPDATE environment_revisions AS er
        SET data = jsonb_set(
            er.data::jsonb,
            '{references}',
            rebuilt_references.references,
            false
        )::json
        FROM rebuilt_references
        WHERE er.id = rebuilt_references.environment_revision_id
    """)

    result = session.execute(query, {"project_id": project_id})
    return result.rowcount


def upgrade_workflow_revision_versions(session: Connection) -> None:
    """Add missing v0 seeds and repair duplicate workflow revision versions.

    The v0.84 application migration copied legacy app revision numbers directly
    into workflow_revisions without creating the seed v0 row. Later normal
    workflow commits assign versions by positional count, so variants missing
    v0 can eventually collide with existing stored versions.

    Insert missing v0 rows for every affected variant, but only recompute
    chronological versions for variants that actually have duplicate versions.
    Rewrite environment revision references only for changed revision ids.
    """

    last_variant_id: Optional[str] = None
    seeded_variants = 0
    repaired_duplicate_variants = 0
    updated_revisions = 0
    updated_environment_revisions = 0

    while True:
        variants = _fetch_variants_missing_v0(
            session=session,
            last_variant_id=last_variant_id,
            batch_size=BATCH_SIZE,
        )

        if not variants:
            break

        for variant in variants:
            _insert_seed_revision(
                session=session,
                variant=variant,
            )
            seeded_variants += 1

        session.commit()

        last_variant_id = str(variants[-1].variant_id)
        click.echo(f"  ... seeded {seeded_variants} workflow variants missing v0")

    last_variant_id = None

    while True:
        variants = _fetch_variants_with_duplicate_versions(
            session=session,
            last_variant_id=last_variant_id,
            batch_size=BATCH_SIZE,
        )

        if not variants:
            break

        batch_mapping: list[dict[str, Any]] = []
        for variant in variants:
            update_count, mapping = _repair_duplicate_variant_versions(
                session=session,
                variant=variant,
            )
            updated_revisions += update_count
            repaired_duplicate_variants += 1
            batch_mapping.extend(mapping)

        if batch_mapping:
            _create_revision_version_mapping(
                session=session,
                batch_mapping=batch_mapping,
            )
            for project_id in sorted(
                {mapping["project_id"] for mapping in batch_mapping}
            ):
                updated_environment_revisions += _update_environment_references(
                    session=session,
                    project_id=project_id,
                )

        session.commit()

        last_variant_id = str(variants[-1].variant_id)
        click.echo(
            f"  ... repaired {repaired_duplicate_variants} duplicate-version "
            f"workflow variants, "
            f"updated {updated_revisions} workflow revisions, "
            f"updated {updated_environment_revisions} environment revisions"
        )

    click.echo(
        click.style(
            f"Seeded {seeded_variants} workflow variants missing v0; "
            f"repaired {repaired_duplicate_variants} duplicate-version "
            f"workflow variants; updated {updated_revisions} workflow revisions "
            f"and "
            f"{updated_environment_revisions} environment revisions.",
            fg="green",
        ),
        color=True,
    )


def downgrade_workflow_revision_versions(session: Connection) -> None:
    """Downgrade is not supported."""

    raise NotImplementedError(
        "Downgrade is not supported: this migration inserts seed workflow "
        "revisions and rewrites revision versions. Restore from backup if needed."
    )
