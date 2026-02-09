import asyncio
import uuid
from typing import Dict, List, Optional

import click
from pydantic import field_validator
from sqlalchemy import func
from sqlalchemy.ext.asyncio import AsyncConnection, create_async_engine
from sqlalchemy.future import select

from ee.src.models.db_models import WorkspaceMemberDB as WorkspaceMemberDBE
from oss.src.core.environments.dtos import (
    EnvironmentCreate,
    EnvironmentRevisionCommit,
    EnvironmentVariantCreate,
)
from oss.src.core.environments.service import EnvironmentsService
from oss.src.core.shared.dtos import Reference
from oss.src.dbs.postgres.environments.dbes import (
    EnvironmentArtifactDBE,
    EnvironmentRevisionDBE,
    EnvironmentVariantDBE,
)
from oss.src.dbs.postgres.git.dao import GitDAO
from oss.src.models.db_models import ProjectDB as ProjectDBE

DEFAULT_BATCH_SIZE = 200
DEFAULT_ENVIRONMENTS = ("development", "staging", "production")


environments_dao = GitDAO(
    ArtifactDBE=EnvironmentArtifactDBE,
    VariantDBE=EnvironmentVariantDBE,
    RevisionDBE=EnvironmentRevisionDBE,
)
environments_service = EnvironmentsService(
    environments_dao=environments_dao,
)


class LegacyEnvironmentVariantCreate(EnvironmentVariantCreate):
    @field_validator("slug")
    @classmethod
    def check_url_safety(cls, v):  # noqa: N805
        return v


async def _fetch_target_project_ids(
    *,
    connection: AsyncConnection,
) -> List[uuid.UUID]:
    result = await connection.execute(
        select(ProjectDBE.id)
        .where(
            ~select(EnvironmentArtifactDBE.id)
            .where(EnvironmentArtifactDBE.project_id == ProjectDBE.id)
            .exists()
        )
        .order_by(ProjectDBE.id)
    )
    return [row.id for row in result.fetchall()]


async def _fetch_project_owners_batch(
    *,
    project_ids: List[uuid.UUID],
    connection: AsyncConnection,
) -> Dict[uuid.UUID, uuid.UUID]:
    if not project_ids:
        return {}

    workspace_owner_query = (
        select(
            ProjectDBE.id.label("project_id"),
            WorkspaceMemberDBE.user_id.label("owner_id"),
            WorkspaceMemberDBE.created_at,
        )
        .select_from(WorkspaceMemberDBE)
        .join(ProjectDBE, WorkspaceMemberDBE.workspace_id == ProjectDBE.workspace_id)
        .where(
            WorkspaceMemberDBE.role == "owner",
            ProjectDBE.id.in_(project_ids),
        )
        .order_by(ProjectDBE.id, WorkspaceMemberDBE.created_at.asc())
        .distinct(ProjectDBE.id)
    )

    result = await connection.execute(workspace_owner_query)
    rows = result.fetchall()

    return {row.project_id: row.owner_id for row in rows}


async def _project_has_any_environment(
    *,
    connection: AsyncConnection,
    project_id: uuid.UUID,
) -> bool:
    result = await connection.execute(
        select(func.count())
        .select_from(EnvironmentArtifactDBE)
        .where(EnvironmentArtifactDBE.project_id == project_id)
    )
    return (result.scalar() or 0) > 0


async def _create_default_environment(
    *,
    project_id: uuid.UUID,
    owner_id: uuid.UUID,
    environment_slug: str,
) -> bool:
    existing = await environments_service.fetch_environment(
        project_id=project_id,
        environment_ref=Reference(slug=environment_slug),
    )

    if existing is not None:
        return False

    environment = await environments_service.create_environment(
        project_id=project_id,
        user_id=owner_id,
        environment_create=EnvironmentCreate(
            slug=environment_slug,
            name=environment_slug,
        ),
    )

    if environment is None:
        return False

    environment_variant = await environments_service.create_environment_variant(
        project_id=project_id,
        user_id=owner_id,
        environment_variant_create=LegacyEnvironmentVariantCreate(
            slug=f"{environment_slug}.default",
            name=environment_slug,
            environment_id=environment.id,
        ),
    )

    if environment_variant is None:
        return False

    environment_revision = await environments_service.commit_environment_revision(
        project_id=project_id,
        user_id=owner_id,
        environment_revision_commit=EnvironmentRevisionCommit(
            slug=uuid.uuid4().hex[-12:],
            name=environment_slug,
            data=None,
            message="Initial commit",
            environment_id=environment.id,
            environment_variant_id=environment_variant.id,
        ),
    )

    return environment_revision is not None


async def migration_create_default_environments(
    connection: AsyncConnection,
):
    target_project_ids = await _fetch_target_project_ids(connection=connection)
    total_projects = len(target_project_ids)

    click.echo(
        click.style(
            (f"Target projects without environments: {total_projects}"),
            fg="yellow",
        )
    )

    project_owners = await _fetch_project_owners_batch(
        project_ids=target_project_ids,
        connection=connection,
    )

    created_environments = 0
    skipped_projects = 0

    for idx, project_id in enumerate(target_project_ids, start=1):
        owner_id: Optional[uuid.UUID] = project_owners.get(project_id)

        if owner_id is None:
            skipped_projects += 1
            continue

        if await _project_has_any_environment(
            connection=connection,
            project_id=project_id,
        ):
            skipped_projects += 1
            continue

        for environment_slug in DEFAULT_ENVIRONMENTS:
            created = await _create_default_environment(
                project_id=project_id,
                owner_id=owner_id,
                environment_slug=environment_slug,
            )
            if created:
                created_environments += 1

        if idx % DEFAULT_BATCH_SIZE == 0 or idx == total_projects:
            click.echo(
                click.style(
                    (
                        "Processed projects "
                        f"{idx}/{total_projects}; "
                        f"created_environments={created_environments}; "
                        f"skipped_projects={skipped_projects}"
                    ),
                    fg="yellow",
                )
            )

    click.echo(
        click.style(
            f"Done. Created environments: {created_environments}",
            fg="yellow",
        )
    )
    click.echo(
        click.style(
            f"Skipped projects: {skipped_projects}",
            fg="yellow",
        )
    )


def run_migration(sqlalchemy_url: str):
    import concurrent.futures

    async def _start():
        engine = create_async_engine(url=sqlalchemy_url)
        async with engine.begin() as connection:
            await migration_create_default_environments(connection=connection)
        await engine.dispose()

    with concurrent.futures.ThreadPoolExecutor() as executor:
        future = executor.submit(asyncio.run, _start())
        future.result()
