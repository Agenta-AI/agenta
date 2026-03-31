import uuid
import asyncio
import traceback
from uuid import UUID
from typing import Optional, Dict, List

import click
from sqlalchemy.future import select
from sqlalchemy import func
from sqlalchemy.ext.asyncio import AsyncConnection, create_async_engine

from oss.src.models.db_models import ProjectDB as ProjectDBE
from oss.src.models.db_models import EvaluatorConfigDB
from oss.src.dbs.postgres.workflows.dbes import (
    WorkflowArtifactDBE,
    WorkflowVariantDBE,
    WorkflowRevisionDBE,
)
from oss.src.dbs.postgres.git.dao import GitDAO
from oss.src.core.evaluators.service import SimpleEvaluatorsService, EvaluatorsService
from oss.src.core.evaluators.dtos import (
    SimpleEvaluator,
    SimpleEvaluatorCreate,
    SimpleEvaluatorEdit,
    SimpleEvaluatorData,
    SimpleEvaluatorFlags,
)
from oss.src.core.evaluators.utils import build_evaluator_data
from oss.src.models.deprecated_models import (
    DeprecatedAutoEvaluatorConfigDBwProject as DeprecatedEvaluatorConfigDBwProject,
)
from oss.src.models.db_models import OrganizationDB
from oss.src.core.workflows.service import WorkflowsService
from oss.src.core.shared.dtos import Reference
from oss.src.utils.helpers import get_slug_from_name_and_id
from oss.src.services.db_manager import fetch_evaluator_config


# Define constants
DEFAULT_BATCH_SIZE = 200

# Initialize plug-ins for migration
workflows_dao = GitDAO(
    ArtifactDBE=WorkflowArtifactDBE,
    VariantDBE=WorkflowVariantDBE,
    RevisionDBE=WorkflowRevisionDBE,
)
workflows_service = WorkflowsService(
    workflows_dao=workflows_dao,
)
evaluators_service = EvaluatorsService(
    workflows_service=workflows_service,
)
simple_evaluators_service = SimpleEvaluatorsService(
    evaluators_service=evaluators_service,
)


def _transfer_evaluator_revision_data(
    old_evaluator: EvaluatorConfigDB,
) -> SimpleEvaluatorData:
    """Convert old evaluator config to new SimpleEvaluatorData format."""
    return build_evaluator_data(
        evaluator_key=old_evaluator.evaluator_key,
        settings_values=old_evaluator.settings_values,
    )


async def _transfer_evaluator(
    *,
    project_id: UUID,
    user_id: UUID,
    evaluator_id: UUID,
) -> Optional[SimpleEvaluator]:
    """Transfer an old evaluator config to the new workflow-based system."""
    old_evaluator = await fetch_evaluator_config(
        evaluator_config_id=str(evaluator_id),
    )

    if old_evaluator is None:
        return None

    evaluator_revision_data = _transfer_evaluator_revision_data(
        old_evaluator=old_evaluator,
    )

    evaluator_ref = Reference(id=evaluator_id)

    new_evaluator = await evaluators_service.fetch_evaluator(
        project_id=project_id,
        evaluator_ref=evaluator_ref,
    )

    if new_evaluator is None:
        name = str(old_evaluator.name)
        slug = get_slug_from_name_and_id(
            name=name,
            id=evaluator_id,
        )

        evaluator_create = SimpleEvaluatorCreate(
            slug=slug,
            name=name,
            description=None,
            flags=SimpleEvaluatorFlags(
                is_evaluator=True,
            ),
            tags=None,
            meta=None,
            data=SimpleEvaluatorData(
                **evaluator_revision_data.model_dump(
                    mode="json",
                )
            ),
        )
        simple_evaluator = await simple_evaluators_service.create(
            project_id=project_id,
            user_id=user_id,
            simple_evaluator_create=evaluator_create,
            evaluator_id=evaluator_id,
        )

        return simple_evaluator

    evaluator_edit = SimpleEvaluatorEdit(
        id=evaluator_id,
        name=new_evaluator.name,
        description=new_evaluator.description,
        flags=(
            SimpleEvaluatorFlags(
                **new_evaluator.flags.model_dump(
                    mode="json",
                    exclude_none=True,
                    exclude_unset=True,
                )
            )
            if new_evaluator.flags
            else None
        ),
        tags=new_evaluator.tags,
        meta=new_evaluator.meta,
        data=SimpleEvaluatorData(
            **evaluator_revision_data.model_dump(
                mode="json",
            )
        ),
    )

    simple_evaluator = await simple_evaluators_service.edit(
        project_id=project_id,
        user_id=user_id,
        simple_evaluator_edit=evaluator_edit,
    )

    return simple_evaluator


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


async def migration_old_evaluator_configs_to_new_evaluator_configs(
    connection: AsyncConnection,
):
    """Migrate old evaluator configurations to new workflow-based system."""
    try:
        offset = 0
        total_migrated = 0
        skipped_records = 0

        # Count total rows with a non-null project_id
        total_query = (
            select(func.count())
            .select_from(DeprecatedEvaluatorConfigDBwProject)
            .filter(DeprecatedEvaluatorConfigDBwProject.project_id.isnot(None))
        )
        result = await connection.execute(total_query)
        total_rows = result.scalar()
        total_evaluators = total_rows or 0

        click.echo(
            click.style(
                f"Total rows in evaluator_configs with project_id: {total_evaluators}",
                fg="yellow",
            )
        )

        while offset < total_evaluators:
            # STEP 1: Fetch evaluator configurations with non-null project_id
            result = await connection.execute(
                select(DeprecatedEvaluatorConfigDBwProject)
                .filter(DeprecatedEvaluatorConfigDBwProject.project_id.isnot(None))
                .order_by(DeprecatedEvaluatorConfigDBwProject.id)
                .offset(offset)
                .limit(DEFAULT_BATCH_SIZE)
            )
            evaluator_configs_rows = result.fetchall()

            if not evaluator_configs_rows:
                break

            # STEP 2: Batch fetch all project owners for this batch
            unique_project_ids = list(
                {
                    row.project_id
                    for row in evaluator_configs_rows
                    if row.project_id is not None
                }
            )
            project_owners = await _fetch_project_owners_batch(
                project_ids=unique_project_ids,
                connection=connection,
            )

            # Process and transfer records to evaluator workflows
            batch_succeeded = 0
            for old_evaluator in evaluator_configs_rows:
                try:
                    # Get owner from pre-fetched batch
                    owner = project_owners.get(old_evaluator.project_id)
                    if not owner:
                        skipped_records += 1
                        click.echo(
                            click.style(
                                f"Skipping record with ID {old_evaluator.id} due to missing owner in workspace member table",
                                fg="yellow",
                            )
                        )
                        continue

                    # STEP 3: Migrate records using local transfer function
                    new_evaluator = await _transfer_evaluator(
                        project_id=old_evaluator.project_id,
                        user_id=owner,
                        evaluator_id=old_evaluator.id,
                    )
                    if not new_evaluator:
                        skipped_records += 1
                        click.echo(
                            click.style(
                                f"Skipping record with ID {old_evaluator.id} due to old evaluator not existing in database table",
                                fg="yellow",
                            )
                        )
                        continue

                    batch_succeeded += 1

                except Exception as e:
                    click.echo(
                        click.style(
                            f"Failed to migrate evaluator {old_evaluator.id}: {str(e)}",
                            fg="red",
                        )
                    )
                    click.echo(click.style(traceback.format_exc(), fg="red"))
                    skipped_records += 1
                    continue

            # Update progress tracking for current batch
            batch_processed = len(evaluator_configs_rows)
            offset += DEFAULT_BATCH_SIZE
            total_migrated += batch_succeeded

            click.echo(
                click.style(
                    f"Processed {batch_processed} records in this batch ({batch_succeeded} succeeded).",
                    fg="yellow",
                )
            )

        # Update progress tracking for all batches
        not_migrated = total_evaluators - total_migrated - skipped_records
        click.echo(click.style(f"Total migrated: {total_migrated}", fg="yellow"))
        click.echo(click.style(f"Skipped records: {skipped_records}", fg="yellow"))
        click.echo(click.style(f"Not migrated: {not_migrated}", fg="yellow"))

    except Exception as e:
        click.echo(f"Error occurred: {e}")
        click.echo(click.style(traceback.format_exc(), fg="red"))


def run_migration(sqlalchemy_url: str):
    import concurrent.futures

    async def _start():
        connection = create_async_engine(url=sqlalchemy_url)
        async with connection.connect() as connection:
            await migration_old_evaluator_configs_to_new_evaluator_configs(
                connection=connection
            )

    with concurrent.futures.ThreadPoolExecutor() as executor:
        future = executor.submit(asyncio.run, _start())
        future.result()
