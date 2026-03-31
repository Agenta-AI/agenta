import re
import uuid
import asyncio
from uuid import UUID
from typing import Any, Optional, Dict, List
from collections import defaultdict

import click
from pydantic import field_validator
from sqlalchemy import func
from sqlalchemy.future import select
from sqlalchemy.ext.asyncio import AsyncConnection, create_async_engine

from oss.src.models.db_models import (
    ProjectDB as ProjectDBE,
    AppDB,
    AppVariantDB,
    AppVariantRevisionsDB,
    AppEnvironmentDB,
    AppEnvironmentRevisionDB,
)
from oss.src.dbs.postgres.environments.dbes import (
    EnvironmentArtifactDBE,
    EnvironmentVariantDBE,
    EnvironmentRevisionDBE,
)
from oss.src.dbs.postgres.git.dao import GitDAO
from oss.src.core.environments.service import (
    EnvironmentsService,
)
from oss.src.core.environments.dtos import (
    Environment,
    EnvironmentCreate,
    EnvironmentVariantCreate,
    EnvironmentRevisionCommit,
    EnvironmentRevisionData,
)
from oss.src.core.shared.dtos import Reference
from oss.src.models.db_models import OrganizationDB


# Define constants
DEFAULT_BATCH_SIZE = 200

# Initialize plug-ins for migration
environments_dao = GitDAO(
    ArtifactDBE=EnvironmentArtifactDBE,
    VariantDBE=EnvironmentVariantDBE,
    RevisionDBE=EnvironmentRevisionDBE,
)
environments_service = EnvironmentsService(
    environments_dao=environments_dao,
)


def _sanitize_slug(value: Optional[str]) -> Optional[str]:
    """Replace characters not allowed in slugs with underscores."""
    if value is None:
        return None
    return re.sub(r"[^a-zA-Z0-9_.\-]", "_", value)


async def _resolve_full_refs(
    *,
    deployed_app_variant_revision_id: uuid.UUID,
    app_id: uuid.UUID,
    app_name: str,
    connection: AsyncConnection,
) -> Dict[str, Reference]:
    """Resolve the full reference chain for a deployed app variant revision.

    Returns a dict with keys: application, application_variant, application_revision.
    """
    # Fetch the app variant revision row
    rev_query = select(
        AppVariantRevisionsDB.id,
        AppVariantRevisionsDB.variant_id,
        AppVariantRevisionsDB.revision,
        AppVariantRevisionsDB.config_name,
    ).where(AppVariantRevisionsDB.id == deployed_app_variant_revision_id)
    result = await connection.execute(rev_query)
    rev_row = result.first()

    variant_id = None
    variant_name = None
    rev_version = None
    rev_slug = None

    if rev_row is not None:
        variant_id = rev_row.variant_id
        rev_version = str(rev_row.revision) if rev_row.revision is not None else None
        rev_slug = rev_row.config_name

        # Fetch the app variant row
        if variant_id is not None:
            var_query = select(
                AppVariantDB.id,
                AppVariantDB.variant_name,
            ).where(AppVariantDB.id == variant_id)
            var_result = await connection.execute(var_query)
            var_row = var_result.first()
            if var_row is not None:
                variant_name = var_row.variant_name

    return {
        "application": Reference(
            id=app_id,
            slug=_sanitize_slug(app_name),
        ),
        "application_variant": Reference(
            id=variant_id,
            slug=_sanitize_slug(variant_name),
        ),
        "application_revision": Reference(
            id=deployed_app_variant_revision_id,
            slug=_sanitize_slug(rev_slug),
            version=rev_version,
        ),
    }


async def _fetch_app_names_batch(
    *,
    app_ids: List[uuid.UUID],
    connection: AsyncConnection,
) -> Dict[uuid.UUID, str]:
    """Fetch app names for multiple app_ids in a single query."""
    if not app_ids:
        return {}
    query = select(AppDB.id, AppDB.app_name).where(AppDB.id.in_(app_ids))
    result = await connection.execute(query)
    return {row.id: row.app_name for row in result.fetchall()}


async def _fetch_project_owners_batch(
    *,
    project_ids: List[uuid.UUID],
    connection: AsyncConnection,
) -> Dict[uuid.UUID, uuid.UUID]:
    """Fetch owner user IDs for multiple projects in a single query.

    Returns a dict mapping project_id -> owner_user_id.
    """
    if not project_ids:
        return {}

    organization_owner_query = (
        select(
            ProjectDBE.id.label("project_id"),
            OrganizationDB.owner_id.label("owner_id"),
        )
        .select_from(ProjectDBE)
        .join(
            OrganizationDB,
            ProjectDBE.organization_id == OrganizationDB.id,
        )
        .where(ProjectDBE.id.in_(project_ids))
    )

    result = await connection.execute(organization_owner_query)
    rows = result.fetchall()

    return {row.project_id: row.owner_id for row in rows if row.owner_id is not None}


async def _transfer_environment_for_project(
    *,
    project_id: UUID,
    owner_id: UUID,
    env_name: str,
    app_revisions: Dict[str, List[Any]],
    app_ids: Dict[str, uuid.UUID],
    connection: AsyncConnection,
) -> Optional[Environment]:
    """
    Transfer a single environment (identified by env_name) for a project.

    app_revisions: dict mapping app_name -> list of AppEnvironmentRevisionDB rows
                   ordered by created_at ascending.
    app_ids: dict mapping app_name -> app UUID.
    """
    # Check if environment already exists
    existing = await environments_service.fetch_environment(
        project_id=project_id,
        environment_ref=Reference(slug=env_name),
    )

    if existing is not None:
        click.echo(
            click.style(
                f"  Environment '{env_name}' already exists (id={existing.id}), skipping.",
                fg="yellow",
            )
        )
        return None

    # Create the environment artifact directly (not via SimpleEnvironmentsService)
    environment = await environments_service.create_environment(
        project_id=project_id,
        user_id=owner_id,
        environment_create=EnvironmentCreate(
            slug=env_name,
            name=env_name,
        ),
    )

    if environment is None:
        click.echo(
            click.style(
                f"  Failed to create environment '{env_name}'.",
                fg="red",
            )
        )
        return None

    # -- Legacy subclass: allow dots in slugs for compound env variant slugs ------
    class LegacyEnvironmentVariantCreate(EnvironmentVariantCreate):
        """EnvironmentVariantCreate that allows dots in slugs."""

        @field_validator("slug")
        @classmethod
        def check_url_safety(cls, v: Any) -> Any:
            return v

    # Create the default variant with slug = {env_name}.default
    environment_variant = await environments_service.create_environment_variant(
        project_id=project_id,
        user_id=owner_id,
        environment_variant_create=LegacyEnvironmentVariantCreate(
            slug=f"{env_name}.default",
            name=env_name,
            environment_id=environment.id,
        ),
    )

    if environment_variant is None:
        click.echo(
            click.style(
                f"  Failed to create variant for environment '{env_name}'.",
                fg="red",
            )
        )
        return None

    # Create the initial commit (v0) with no data
    initial_revision_commit = EnvironmentRevisionCommit(
        slug=uuid.uuid4().hex[-12:],
        name=env_name,
        data=None,
        message="Initial commit",
        environment_id=environment.id,
        environment_variant_id=environment_variant.id,
    )

    initial_revision = await environments_service.commit_environment_revision(
        project_id=project_id,
        user_id=owner_id,
        environment_revision_commit=initial_revision_commit,
    )

    if initial_revision is None:
        return None

    # Determine the maximum number of revisions across all apps
    if not app_revisions:
        return environment
    max_revisions = max(len(revs) for revs in app_revisions.values())

    if max_revisions == 0:
        return environment

    # For each revision index, build merged data across apps and commit
    for rev_idx in range(max_revisions):
        references: Dict[str, Dict[str, Reference]] = {}

        for app_name, revs in app_revisions.items():
            if not revs:
                continue

            if rev_idx < len(revs):
                rev = revs[rev_idx]
            else:
                # Carry forward: use the last available revision for this app
                rev = revs[-1]

            # Build full references for this app
            if rev.deployed_app_variant_revision_id is not None:
                app_id = app_ids.get(app_name)
                full_refs = await _resolve_full_refs(
                    deployed_app_variant_revision_id=rev.deployed_app_variant_revision_id,
                    app_id=app_id,
                    app_name=app_name,
                    connection=connection,
                )
                references[f"{app_name}.revision"] = full_refs

        # Skip the first old revision (rev_idx == 0) if it has no deployments,
        # since the initial commit (v0) already represents "nothing deployed".
        if rev_idx == 0 and not references:
            continue

        # Determine actor: modified_by_id -> created_by_id -> owner fallback
        representative_rev = None
        for _app_name, revs in app_revisions.items():
            if rev_idx < len(revs):
                representative_rev = revs[rev_idx]
                break

        actor_id = owner_id
        commit_message = None

        if representative_rev is not None:
            if representative_rev.modified_by_id is not None:
                actor_id = representative_rev.modified_by_id
            elif representative_rev.created_by_id is not None:
                actor_id = representative_rev.created_by_id
            commit_message = representative_rev.commit_message

        # Commit the revision
        revision_slug = uuid.uuid4().hex[-12:]

        environment_revision_commit = EnvironmentRevisionCommit(
            slug=revision_slug,
            name=env_name,
            data=EnvironmentRevisionData(references=references),
            message=commit_message,
            environment_id=environment.id,
            environment_variant_id=environment_variant.id,
        )

        await environments_service.commit_environment_revision(
            project_id=project_id,
            user_id=actor_id,
            environment_revision_commit=environment_revision_commit,
        )

    return environment


async def migration_old_environments_to_new_environments(
    connection: AsyncConnection,
):
    """Migrate old app-scoped environments to new project-scoped git-based environments."""
    # Count total projects
    count_query = select(func.count(AppEnvironmentDB.project_id.distinct())).where(
        AppEnvironmentDB.project_id.isnot(None)
    )
    result = await connection.execute(count_query)
    total_projects = result.scalar() or 0

    click.echo(
        click.style(
            f"Found {total_projects} projects with environments to migrate.",
            fg="yellow",
        )
    )

    total_migrated = 0
    skipped_projects = 0
    offset = 0

    while True:
        # Fetch batch of project_ids
        project_ids_query = (
            select(AppEnvironmentDB.project_id)
            .distinct()
            .where(AppEnvironmentDB.project_id.isnot(None))
            .order_by(AppEnvironmentDB.project_id)
            .offset(offset)
            .limit(DEFAULT_BATCH_SIZE)
        )
        result = await connection.execute(project_ids_query)
        project_ids = [row[0] for row in result.fetchall()]

        if not project_ids:
            break

        # Batch fetch project owners for this batch
        project_owners = await _fetch_project_owners_batch(
            project_ids=project_ids,
            connection=connection,
        )

        for project_idx, project_id in enumerate(project_ids):
            global_idx = offset + project_idx + 1
            click.echo(
                click.style(
                    f"Processing project {global_idx}/{total_projects}: {project_id}",
                    fg="yellow",
                )
            )

            # Get owner from pre-fetched batch
            owner_id = project_owners.get(project_id)

            if not owner_id:
                click.echo(
                    click.style(
                        f"  Skipping project {project_id}: no owner found.",
                        fg="yellow",
                    )
                )
                skipped_projects += 1
                continue

            # Fetch all old environments for this project
            envs_query = (
                select(AppEnvironmentDB)
                .where(AppEnvironmentDB.project_id == project_id)
                .order_by(AppEnvironmentDB.name)
            )
            result = await connection.execute(envs_query)
            old_envs = result.fetchall()

            if not old_envs:
                continue

            # Batch fetch all app names for this project's environments
            unique_app_ids = list(
                {old_env.app_id for old_env in old_envs if old_env.app_id is not None}
            )
            app_names_map = await _fetch_app_names_batch(
                app_ids=unique_app_ids,
                connection=connection,
            )

            # Group by environment name -> app_name -> list of revisions
            # Also track app_name -> app_id for resolving full refs
            env_groups: Dict[str, Dict[str, List[Any]]] = defaultdict(
                lambda: defaultdict(list)
            )
            env_app_ids: Dict[str, Dict[str, uuid.UUID]] = defaultdict(dict)

            for old_env in old_envs:
                env_name = old_env.name
                app_id = old_env.app_id

                # Get app name from pre-fetched batch
                app_name = app_names_map.get(app_id)
                if app_name is None:
                    app_name = str(app_id)

                # Fetch revisions for this environment
                revs_query = (
                    select(AppEnvironmentRevisionDB)
                    .where(
                        AppEnvironmentRevisionDB.environment_id == old_env.id,
                        AppEnvironmentRevisionDB.project_id == project_id,
                    )
                    .order_by(AppEnvironmentRevisionDB.created_at.asc())
                )
                result = await connection.execute(revs_query)
                revisions = result.fetchall()

                env_groups[env_name][app_name] = revisions
                env_app_ids[env_name][app_name] = app_id

            # Process each environment name
            for env_name, app_revisions in env_groups.items():
                new_env = await _transfer_environment_for_project(
                    project_id=project_id,
                    owner_id=owner_id,
                    env_name=env_name,
                    app_revisions=app_revisions,
                    app_ids=env_app_ids[env_name],
                    connection=connection,
                )
                if new_env:
                    total_migrated += 1

        # Move to next batch
        offset += DEFAULT_BATCH_SIZE

    click.echo(
        click.style(f"Total environments migrated: {total_migrated}", fg="yellow")
    )
    click.echo(click.style(f"Skipped projects: {skipped_projects}", fg="yellow"))


def run_migration(sqlalchemy_url: str):
    import concurrent.futures

    async def _start():
        engine = create_async_engine(url=sqlalchemy_url)
        async with engine.begin() as connection:
            await migration_old_environments_to_new_environments(connection=connection)
        await engine.dispose()

    with concurrent.futures.ThreadPoolExecutor() as executor:
        future = executor.submit(asyncio.run, _start())
        future.result()
