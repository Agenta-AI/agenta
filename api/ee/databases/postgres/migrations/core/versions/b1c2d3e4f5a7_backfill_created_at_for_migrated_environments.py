"""backfill created_at for migrated environments

Revision ID: b1c2d3e4f5a7
Revises: f1e2d3c4b5a6
Create Date: 2026-02-09 00:10:00.000000

"""

from datetime import datetime
from collections import defaultdict
from typing import Dict, List, Sequence, Tuple, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.engine import Connection

# revision identifiers, used by Alembic.
revision: str = "b1c2d3e4f5a7"
down_revision: Union[str, None] = "f1e2d3c4b5a6"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

BATCH_SIZE = 500

EnvKey = Tuple[str, str]


ARTIFACTS_SQL = sa.text(
    """
    WITH environment_artifact_sources AS (
        SELECT
            env.project_id,
            env.name AS environment_slug,
            MIN(env.created_at) AS created_at
        FROM environments AS env
        WHERE env.project_id = ANY(CAST(:project_ids AS uuid[]))
          AND env.name IS NOT NULL
          AND env.created_at IS NOT NULL
        GROUP BY env.project_id, env.name
    )
    UPDATE environment_artifacts AS ea
    SET created_at = eas.created_at
    FROM environment_artifact_sources AS eas
    WHERE ea.project_id = eas.project_id
      AND ea.slug = eas.environment_slug
      AND ea.created_at IS DISTINCT FROM eas.created_at;
    """
)


VARIANTS_SQL = sa.text(
    """
    WITH environment_variant_sources AS (
        SELECT
            env.project_id,
            env.name || '.default' AS variant_slug,
            MIN(env.created_at) AS created_at
        FROM environments AS env
        WHERE env.project_id = ANY(CAST(:project_ids AS uuid[]))
          AND env.name IS NOT NULL
          AND env.created_at IS NOT NULL
        GROUP BY env.project_id, env.name
    )
    UPDATE environment_variants AS ev
    SET created_at = evs.created_at
    FROM environment_variant_sources AS evs
    WHERE ev.project_id = evs.project_id
      AND ev.slug = evs.variant_slug
      AND ev.created_at IS DISTINCT FROM evs.created_at;
    """
)


FETCH_ENV_MIN_CREATED_SQL = sa.text(
    """
    SELECT
        env.project_id::text AS project_id,
        env.name AS environment_slug,
        MIN(env.created_at) AS created_at
    FROM environments AS env
    WHERE env.project_id = ANY(CAST(:project_ids AS uuid[]))
      AND env.name IS NOT NULL
      AND env.created_at IS NOT NULL
    GROUP BY env.project_id, env.name
    """
)


FETCH_SELECTED_OLD_ENVS_SQL = sa.text(
    """
    SELECT DISTINCT ON (
        env.project_id,
        env.name,
        COALESCE(app.app_name, env.app_id::text)
    )
        env.project_id::text AS project_id,
        env.name AS environment_slug,
        COALESCE(app.app_name, env.app_id::text) AS app_key,
        env.id::text AS environment_id,
        MIN(env.id::text) OVER (
            PARTITION BY
                env.project_id,
                env.name,
                COALESCE(app.app_name, env.app_id::text)
        ) AS app_order_key
    FROM environments AS env
    LEFT JOIN app_db AS app
        ON app.id = env.app_id
    WHERE env.project_id = ANY(CAST(:project_ids AS uuid[]))
      AND env.name IS NOT NULL
      AND (app.app_name IS NOT NULL OR env.app_id IS NOT NULL)
    ORDER BY
        env.project_id,
        env.name,
        COALESCE(app.app_name, env.app_id::text),
        env.id DESC
    """
)


FETCH_OLD_ENV_REVISIONS_SQL = sa.text(
    """
    SELECT
        env_rev.environment_id::text AS environment_id,
        env_rev.created_at AS created_at,
        env_rev.deployed_app_variant_revision_id IS NOT NULL AS has_reference
    FROM environments_revisions AS env_rev
    WHERE env_rev.project_id = ANY(CAST(:project_ids AS uuid[]))
      AND env_rev.environment_id = ANY(CAST(:environment_ids AS uuid[]))
      AND env_rev.created_at IS NOT NULL
    ORDER BY
        env_rev.environment_id,
        env_rev.created_at ASC,
        env_rev.id ASC
    """
)


UPDATE_ENV_REVISIONS_SQL = sa.text(
    """
    WITH target_versions AS (
        SELECT *
        FROM unnest(
            CAST(:versions AS text[]),
            CAST(:created_ats AS timestamptz[])
        ) AS t(version, created_at)
    )
    UPDATE environment_revisions AS er
    SET created_at = tv.created_at,
        date = tv.created_at
    FROM environment_artifacts AS ea
    JOIN environment_variants AS ev
        ON ev.project_id = ea.project_id
       AND ev.artifact_id = ea.id
       AND ev.slug = ea.slug || '.default'
    JOIN target_versions AS tv
        ON TRUE
    WHERE ea.project_id = CAST(:project_id AS uuid)
      AND ea.slug = :environment_slug
      AND er.project_id = ea.project_id
      AND er.artifact_id = ea.id
      AND er.variant_id = ev.id
      AND tv.version = er.version
      AND (
          er.created_at IS DISTINCT FROM tv.created_at
          OR er.date IS DISTINCT FROM tv.created_at
      );
    """
)


def _print(message: str) -> None:
    ctx = op.get_context()
    config = getattr(ctx, "config", None)
    if config is not None and hasattr(config, "print_stdout"):
        config.print_stdout(message)
    else:
        print(message)


def _fetch_project_ids_batch(
    connection: Connection,
    *,
    offset: int,
    limit: int,
) -> List[str]:
    result = connection.execute(
        sa.text(
            """
            SELECT project_id::text
            FROM (
                SELECT DISTINCT project_id
                FROM environments
                WHERE project_id IS NOT NULL
            ) AS project_ids
            ORDER BY project_id
            OFFSET :offset
            LIMIT :limit
            """
        ),
        {
            "offset": offset,
            "limit": limit,
        },
    )
    return [row[0] for row in result.fetchall()]


def _fetch_env_min_created(
    connection: Connection,
    *,
    project_ids: List[str],
) -> Dict[EnvKey, datetime]:
    result = connection.execute(
        FETCH_ENV_MIN_CREATED_SQL,
        {"project_ids": project_ids},
    )

    env_min_created: Dict[EnvKey, datetime] = {}
    for row in result.fetchall():
        env_min_created[(row.project_id, row.environment_slug)] = row.created_at

    return env_min_created


def _fetch_selected_old_envs(
    connection: Connection,
    *,
    project_ids: List[str],
) -> List[sa.Row]:
    result = connection.execute(
        FETCH_SELECTED_OLD_ENVS_SQL,
        {"project_ids": project_ids},
    )
    return result.fetchall()


def _fetch_old_env_revisions(
    connection: Connection,
    *,
    project_ids: List[str],
    environment_ids: List[str],
) -> Dict[str, List[Tuple[datetime, bool]]]:
    if not environment_ids:
        return {}

    result = connection.execute(
        FETCH_OLD_ENV_REVISIONS_SQL,
        {
            "project_ids": project_ids,
            "environment_ids": environment_ids,
        },
    )

    revisions_by_environment_id: Dict[str, List[Tuple[datetime, bool]]] = defaultdict(
        list
    )
    for row in result.fetchall():
        revisions_by_environment_id[row.environment_id].append(
            (row.created_at, bool(row.has_reference))
        )

    return revisions_by_environment_id


def _build_revision_targets(
    *,
    env_min_created: Dict[EnvKey, datetime],
    selected_old_env_rows: List[sa.Row],
    revisions_by_environment_id: Dict[str, List[Tuple[datetime, bool]]],
) -> Dict[EnvKey, List[Tuple[str, datetime]]]:
    app_streams_by_env: Dict[
        EnvKey, List[Tuple[str, str, List[Tuple[datetime, bool]]]]
    ] = defaultdict(list)

    for row in selected_old_env_rows:
        app_revisions = revisions_by_environment_id.get(row.environment_id, [])
        if not app_revisions:
            continue

        env_key = (row.project_id, row.environment_slug)
        app_streams_by_env[env_key].append(
            (
                row.app_order_key,
                row.app_key,
                app_revisions,
            )
        )

    revision_targets: Dict[EnvKey, List[Tuple[str, datetime]]] = defaultdict(list)

    # v0: oldest legacy environment timestamp for each merged environment.
    for env_key, created_at in env_min_created.items():
        revision_targets[env_key].append(("0", created_at))

    # v1+: merged revision-index logic (carry-forward + skip empty first index).
    for env_key, app_streams in app_streams_by_env.items():
        ordered_streams = sorted(app_streams, key=lambda item: (item[0], item[1]))
        max_revisions = max(len(stream[2]) for stream in ordered_streams)

        committed_created_ats: List[datetime] = []
        for rev_idx in range(max_revisions):
            has_references = False
            representative_created_at = None

            for _app_order_key, _app_key, app_revisions in ordered_streams:
                if rev_idx < len(app_revisions):
                    created_at, has_reference = app_revisions[rev_idx]
                    if representative_created_at is None:
                        representative_created_at = created_at
                else:
                    created_at, has_reference = app_revisions[-1]

                if has_reference:
                    has_references = True

            if rev_idx == 0 and not has_references:
                continue

            if representative_created_at is not None:
                committed_created_ats.append(representative_created_at)

        for version, created_at in enumerate(committed_created_ats, start=1):
            revision_targets[env_key].append((str(version), created_at))

    return revision_targets


def _apply_revision_targets(
    connection: Connection,
    *,
    revision_targets: Dict[EnvKey, List[Tuple[str, datetime]]],
) -> int:
    updated_rows = 0

    for (project_id, environment_slug), target_rows in revision_targets.items():
        versions = [version for version, _created_at in target_rows]
        created_ats = [created_at for _version, created_at in target_rows]

        result = connection.execute(
            UPDATE_ENV_REVISIONS_SQL,
            {
                "project_id": project_id,
                "environment_slug": environment_slug,
                "versions": versions,
                "created_ats": created_ats,
            },
        )
        if result.rowcount and result.rowcount > 0:
            updated_rows += result.rowcount

    return updated_rows


def upgrade() -> None:
    connection = op.get_bind()

    total_projects = connection.execute(
        sa.text(
            """
            SELECT COUNT(*)
            FROM (
                SELECT DISTINCT project_id
                FROM environments
                WHERE project_id IS NOT NULL
            ) AS project_ids
            """
        )
    ).scalar_one()

    _print(f"[created_at backfill][environments] total_projects={total_projects}")

    total_updated_artifacts = 0
    total_updated_variants = 0
    total_updated_revisions = 0

    offset = 0
    processed = 0

    while True:
        project_ids = _fetch_project_ids_batch(
            connection,
            offset=offset,
            limit=BATCH_SIZE,
        )

        if not project_ids:
            break

        params = {
            "project_ids": project_ids,
        }

        artifacts_result = connection.execute(ARTIFACTS_SQL, params)
        variants_result = connection.execute(VARIANTS_SQL, params)

        env_min_created = _fetch_env_min_created(
            connection,
            project_ids=project_ids,
        )
        selected_old_env_rows = _fetch_selected_old_envs(
            connection,
            project_ids=project_ids,
        )
        selected_environment_ids = [row.environment_id for row in selected_old_env_rows]

        old_revisions_by_environment = _fetch_old_env_revisions(
            connection,
            project_ids=project_ids,
            environment_ids=selected_environment_ids,
        )

        revision_targets = _build_revision_targets(
            env_min_created=env_min_created,
            selected_old_env_rows=selected_old_env_rows,
            revisions_by_environment_id=old_revisions_by_environment,
        )
        updated_revisions = _apply_revision_targets(
            connection,
            revision_targets=revision_targets,
        )

        updated_artifacts = artifacts_result.rowcount or 0
        updated_variants = variants_result.rowcount or 0

        total_updated_artifacts += updated_artifacts
        total_updated_variants += updated_variants
        total_updated_revisions += updated_revisions

        processed += len(project_ids)
        offset += BATCH_SIZE

        _print(
            "[created_at backfill][environments] "
            f"processed_projects={processed}/{total_projects} "
            f"batch_size={len(project_ids)} "
            f"updated_artifacts={updated_artifacts} "
            f"updated_variants={updated_variants} "
            f"updated_revisions={updated_revisions}"
        )

    _print(
        "[created_at backfill][environments] "
        f"done updated_artifacts={total_updated_artifacts} "
        f"updated_variants={total_updated_variants} "
        f"updated_revisions={total_updated_revisions}"
    )


def downgrade() -> None:
    pass
