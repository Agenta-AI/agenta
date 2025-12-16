import uuid
import asyncio
import traceback
from typing import Optional

from redis.asyncio import Redis
import click
from sqlalchemy.future import select
from sqlalchemy import func
from sqlalchemy.ext.asyncio import AsyncConnection, create_async_engine

from oss.src.utils.env import env
from ee.src.models.db_models import WorkspaceMemberDB as WorkspaceMemberDBE
from oss.src.models.db_models import ProjectDB as ProjectDBE
from oss.src.dbs.postgres.workflows.dbes import (
    WorkflowArtifactDBE,
    WorkflowVariantDBE,
    WorkflowRevisionDBE,
)
from oss.src.dbs.postgres.git.dao import GitDAO
from oss.src.core.evaluators.service import SimpleEvaluatorsService, EvaluatorsService
from oss.src.models.deprecated_models import (
    DeprecatedAutoEvaluatorConfigDBwProject as DeprecatedEvaluatorConfigDBwProject,
)
from oss.src.core.workflows.service import WorkflowsService
from oss.src.core.tracing.service import TracingService
from oss.src.apis.fastapi.tracing.router import TracingRouter
from oss.src.dbs.postgres.tracing.dao import TracingDAO
from oss.src.tasks.asyncio.tracing.worker import TracingWorker


# Define constants
DEFAULT_BATCH_SIZE = 200

# Initialize plug-ins for migration
tracing_service = TracingService(
    tracing_dao=TracingDAO(),
)

# Redis client and TracingWorker for publishing spans to Redis Streams
if env.REDIS_URI_DURABLE:
    redis_client = Redis.from_url(env.REDIS_URI_DURABLE, decode_responses=False)
    tracing_worker = TracingWorker(
        service=tracing_service,
        redis_client=redis_client,
        stream_name="streams:tracing",
        consumer_group="worker-tracing",
    )
else:
    raise RuntimeError("REDIS_URI_DURABLE is required for tracing worker")

tracing = TracingRouter(
    tracing_service=tracing_service,
    tracing_worker=tracing_worker,
)
evaluators_service = EvaluatorsService(
    workflows_service=WorkflowsService(
        workflows_dao=GitDAO(
            ArtifactDBE=WorkflowArtifactDBE,
            VariantDBE=WorkflowVariantDBE,
            RevisionDBE=WorkflowRevisionDBE,
        ),
    )
)
simple_evaluators_service = SimpleEvaluatorsService(
    evaluators_service=evaluators_service,
)


async def _fetch_project_owner(
    *,
    project_id: uuid.UUID,
    connection: AsyncConnection,
) -> Optional[uuid.UUID]:
    """Fetch the owner user ID for a given project."""
    workspace_owner_query = (
        select(WorkspaceMemberDBE.user_id)
        .select_from(WorkspaceMemberDBE, ProjectDBE)
        .where(
            WorkspaceMemberDBE.workspace_id == ProjectDBE.workspace_id,
            WorkspaceMemberDBE.role == "owner",
            ProjectDBE.id == project_id,
        )
    )
    result = await connection.execute(workspace_owner_query)
    owner = result.scalar_one_or_none()
    return owner


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
                .offset(offset)
                .limit(DEFAULT_BATCH_SIZE)
            )
            evaluator_configs_rows = result.fetchall()

            if not evaluator_configs_rows:
                break

            # Process and transfer records to evaluator workflows
            for old_evaluator in evaluator_configs_rows:
                try:
                    # STEP 2: Get owner from project_id
                    owner = await _fetch_project_owner(
                        project_id=old_evaluator.project_id,  # type: ignore
                        connection=connection,
                    )
                    if not owner:
                        skipped_records += 1
                        click.echo(
                            click.style(
                                f"Skipping record with ID {old_evaluator.id} due to missing owner in workspace member table",
                                fg="yellow",
                            )
                        )
                        continue

                    # STEP 3: Migrate records using transfer_* util function
                    new_evaluator = await simple_evaluators_service.transfer(
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
            batch_migrated = len(evaluator_configs_rows)
            offset += DEFAULT_BATCH_SIZE
            total_migrated += batch_migrated

            click.echo(
                click.style(
                    f"Processed {batch_migrated} records in this batch.",
                    fg="yellow",
                )
            )

        # Update progress tracking for all batches
        remaining_records = total_evaluators - total_migrated
        click.echo(click.style(f"Total migrated: {total_migrated}", fg="yellow"))
        click.echo(click.style(f"Skipped records: {skipped_records}", fg="yellow"))
        click.echo(
            click.style(f"Records left to migrate: {remaining_records}", fg="yellow")
        )

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
