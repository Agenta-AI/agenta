import asyncio
import uuid
from typing import Dict, List, Optional

import click
from pydantic import field_validator
from sqlalchemy import and_, distinct, func
from sqlalchemy.ext.asyncio import AsyncConnection, create_async_engine
from sqlalchemy.future import select

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
from oss.src.models.db_models import OrganizationDB
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


# Correlated subquery: count of fully-complete default environments per project.
# An environment is "complete" when it has an artifact, at least one variant,
# and at least one revision linked to that variant.
_complete_env_count = (
    select(func.count(distinct(EnvironmentArtifactDBE.id)))
    .select_from(EnvironmentArtifactDBE)
    .join(
        EnvironmentVariantDBE,
        and_(
            EnvironmentVariantDBE.project_id == EnvironmentArtifactDBE.project_id,
            EnvironmentVariantDBE.artifact_id == EnvironmentArtifactDBE.id,
        ),
    )
    .join(
        EnvironmentRevisionDBE,
        and_(
            EnvironmentRevisionDBE.project_id == EnvironmentVariantDBE.project_id,
            EnvironmentRevisionDBE.variant_id == EnvironmentVariantDBE.id,
        ),
    )
    .where(
        EnvironmentArtifactDBE.project_id == ProjectDBE.id,
        EnvironmentArtifactDBE.slug.in_(DEFAULT_ENVIRONMENTS),
    )
    .correlate(ProjectDBE)
    .scalar_subquery()
)


async def _fetch_target_project_ids_batch(
    *,
    connection: AsyncConnection,
    last_project_id: Optional[uuid.UUID] = None,
    limit: int = DEFAULT_BATCH_SIZE,
) -> List[uuid.UUID]:
    """Fetch a batch of projects that are missing at least one complete default
    environment, using keyset pagination for stable per-batch cost."""

    query = (
        select(ProjectDBE.id)
        .where(_complete_env_count < len(DEFAULT_ENVIRONMENTS))
        .order_by(ProjectDBE.id)
        .limit(limit)
    )

    if last_project_id is not None:
        query = query.where(ProjectDBE.id > last_project_id)

    result = await connection.execute(query)
    return [row.id for row in result.fetchall()]


async def _fetch_project_owners_batch(
    *,
    project_ids: List[uuid.UUID],
    connection: AsyncConnection,
) -> Dict[uuid.UUID, uuid.UUID]:
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


async def _create_default_environment(
    *,
    project_id: uuid.UUID,
    owner_id: uuid.UUID,
    environment_slug: str,
) -> bool:
    """Idempotently ensure a default environment has its artifact, variant, and
    initial revision.  Returns True when at least one object was created."""

    created = False

    # Step 1: get-or-create environment artifact
    environment = await environments_service.fetch_environment(
        project_id=project_id,
        environment_ref=Reference(slug=environment_slug),
    )

    if environment is None:
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
        created = True

    # Step 2: get-or-create variant
    environment_variant = await environments_service.fetch_environment_variant(
        project_id=project_id,
        environment_ref=Reference(id=environment.id),
    )

    if environment_variant is None:
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
        created = True

    # Step 3: get-or-create initial revision
    environment_revision = await environments_service.fetch_environment_revision(
        project_id=project_id,
        environment_variant_ref=Reference(id=environment_variant.id),
    )

    if environment_revision is None:
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
        if environment_revision is None:
            return False
        created = True

    return created


async def migration_create_default_environments(
    connection: AsyncConnection,
):
    created_environments = 0
    skipped_projects = 0
    processed_projects = 0
    last_project_id: Optional[uuid.UUID] = None

    while True:
        batch = await _fetch_target_project_ids_batch(
            connection=connection,
            last_project_id=last_project_id,
            limit=DEFAULT_BATCH_SIZE,
        )

        if not batch:
            break

        project_owners = await _fetch_project_owners_batch(
            project_ids=batch,
            connection=connection,
        )

        for project_id in batch:
            processed_projects += 1
            owner_id: Optional[uuid.UUID] = project_owners.get(project_id)

            if owner_id is None:
                skipped_projects += 1
                continue

            for environment_slug in DEFAULT_ENVIRONMENTS:
                if await _create_default_environment(
                    project_id=project_id,
                    owner_id=owner_id,
                    environment_slug=environment_slug,
                ):
                    created_environments += 1

        last_project_id = batch[-1]

        click.echo(
            click.style(
                (
                    f"Processed {processed_projects} projects; "
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
