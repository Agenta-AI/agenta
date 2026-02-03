import uuid
import asyncio
import traceback
from uuid import UUID
from typing import Optional, Dict, List, Any
from collections import defaultdict

import click
from sqlalchemy.future import select
from sqlalchemy.ext.asyncio import AsyncConnection, create_async_engine

from oss.src.models.db_models import (
    ProjectDB as ProjectDBE,
    AppDB,
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
    SimpleEnvironmentsService,
)
from oss.src.core.environments.dtos import (
    SimpleEnvironment,
    SimpleEnvironmentCreate,
    EnvironmentRevisionCommit,
    EnvironmentRevisionData,
)
from oss.src.core.shared.dtos import Reference
from oss.src.models.deprecated_models import (
    DeprecatedOrganizationDB,
)


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
simple_environments_service = SimpleEnvironmentsService(
    environments_service=environments_service,
)


async def _fetch_app_name(
    *,
    app_id: uuid.UUID,
    connection: AsyncConnection,
) -> Optional[str]:
    """Fetch the app_name for a given app_id."""
    query = select(AppDB.app_name).where(AppDB.id == app_id)
    result = await connection.execute(query)
    return result.scalar_one_or_none()


async def _fetch_project_owner(
    *,
    project_id: uuid.UUID,
    connection: AsyncConnection,
) -> Optional[uuid.UUID]:
    """Fetch the owner user ID for a given project."""
    organization_owner_query = (
        select(DeprecatedOrganizationDB.owner)
        .select_from(ProjectDBE)
        .join(
            DeprecatedOrganizationDB,
            ProjectDBE.organization_id == DeprecatedOrganizationDB.id,
        )
        .where(ProjectDBE.id == project_id)
    )
    result = await connection.execute(organization_owner_query)
    owner = result.scalar_one_or_none()
    return UUID(owner) if owner is not None else None


async def _transfer_environment_for_project(
    *,
    project_id: UUID,
    owner_id: UUID,
    env_name: str,
    app_revisions: Dict[str, List[Any]],
    connection: AsyncConnection,
) -> Optional[SimpleEnvironment]:
    """
    Transfer a single environment (identified by env_name) for a project.

    app_revisions: dict mapping app_name -> list of AppEnvironmentRevisionDB rows
                   ordered by created_at ascending.
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

    # Create the environment artifact + default variant + initial commit
    simple_env = await simple_environments_service.create(
        project_id=project_id,
        user_id=owner_id,
        simple_environment_create=SimpleEnvironmentCreate(
            slug=env_name,
            name=env_name,
            description=None,
            tags=None,
            meta=None,
            data=None,
        ),
    )

    if simple_env is None:
        click.echo(
            click.style(
                f"  Failed to create environment '{env_name}'.",
                fg="red",
            )
        )
        return None

    # Determine the maximum number of revisions across all apps
    max_revisions = max(len(revs) for revs in app_revisions.values())

    if max_revisions == 0:
        return simple_env

    # For each revision index, build merged data across apps and commit
    for rev_idx in range(max_revisions):
        references: Dict[str, Reference] = {}

        for app_name, revs in app_revisions.items():
            if rev_idx < len(revs):
                rev = revs[rev_idx]
            else:
                # Carry forward: use the last available revision for this app
                rev = revs[-1]

            # Build the reference entry for this app using dot-notation key
            if rev.deployed_app_variant_revision_id is not None:
                references[f"{app_name}.revision"] = Reference(
                    id=rev.deployed_app_variant_revision_id,
                )

        # Determine actor: modified_by_id -> created_by_id -> owner fallback
        # Use the revision that was created at this index from the app with the most revisions
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
            description=None,
            tags=None,
            meta=None,
            data=EnvironmentRevisionData(references=references),
            message=commit_message,
            environment_id=simple_env.id,
            environment_variant_id=None,  # Will be resolved by service
        )

        # Fetch the default variant
        environment_variant = await environments_service.fetch_environment_variant(
            project_id=project_id,
            environment_ref=Reference(id=simple_env.id),
        )

        if environment_variant is not None:
            environment_revision_commit.environment_variant_id = environment_variant.id

        await environments_service.commit_environment_revision(
            project_id=project_id,
            user_id=actor_id,
            environment_revision_commit=environment_revision_commit,
        )

    return simple_env


async def migration_old_environments_to_new_environments(
    connection: AsyncConnection,
):
    """Migrate old app-scoped environments to new project-scoped git-based environments."""
    try:
        # Get all distinct project_ids from the old environments table
        project_ids_query = (
            select(AppEnvironmentDB.project_id)
            .distinct()
            .where(AppEnvironmentDB.project_id.isnot(None))
        )
        result = await connection.execute(project_ids_query)
        project_ids = [row[0] for row in result.fetchall()]

        total_projects = len(project_ids)
        click.echo(
            click.style(
                f"Found {total_projects} projects with environments to migrate.",
                fg="yellow",
            )
        )

        total_migrated = 0
        skipped_projects = 0

        for project_idx, project_id in enumerate(project_ids):
            try:
                click.echo(
                    click.style(
                        f"Processing project {project_idx + 1}/{total_projects}: {project_id}",
                        fg="yellow",
                    )
                )

                # Fetch project owner
                owner_id = await _fetch_project_owner(
                    project_id=project_id,
                    connection=connection,
                )

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

                # Group by environment name -> app_id -> list of revisions
                # env_name -> { app_name -> [revisions ordered by created_at] }
                env_groups: Dict[str, Dict[str, List[Any]]] = defaultdict(
                    lambda: defaultdict(list)
                )

                for old_env in old_envs:
                    env_name = old_env.name
                    app_id = old_env.app_id

                    # Fetch app name
                    app_name = await _fetch_app_name(
                        app_id=app_id,
                        connection=connection,
                    )
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

                # Process each environment name
                for env_name, app_revisions in env_groups.items():
                    try:
                        new_env = await _transfer_environment_for_project(
                            project_id=project_id,
                            owner_id=owner_id,
                            env_name=env_name,
                            app_revisions=app_revisions,
                            connection=connection,
                        )
                        if new_env:
                            total_migrated += 1
                    except Exception as e:
                        click.echo(
                            click.style(
                                f"  Failed to migrate environment '{env_name}' "
                                f"for project {project_id}: {str(e)}",
                                fg="red",
                            )
                        )
                        click.echo(click.style(traceback.format_exc(), fg="red"))

            except Exception as e:
                click.echo(
                    click.style(
                        f"Failed to process project {project_id}: {str(e)}",
                        fg="red",
                    )
                )
                click.echo(click.style(traceback.format_exc(), fg="red"))
                skipped_projects += 1

        click.echo(click.style(f"Total environments migrated: {total_migrated}", fg="yellow"))
        click.echo(click.style(f"Skipped projects: {skipped_projects}", fg="yellow"))

    except Exception as e:
        click.echo(f"Error occurred: {e}")
        click.echo(click.style(traceback.format_exc(), fg="red"))


def run_migration(sqlalchemy_url: str):
    import concurrent.futures

    async def _start():
        connection = create_async_engine(url=sqlalchemy_url)
        async with connection.connect() as connection:
            await migration_old_environments_to_new_environments(
                connection=connection
            )

    with concurrent.futures.ThreadPoolExecutor() as executor:
        future = executor.submit(asyncio.run, _start())
        future.result()
