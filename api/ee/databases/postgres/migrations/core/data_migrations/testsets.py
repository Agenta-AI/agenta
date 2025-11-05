import uuid
import asyncio
import traceback
from typing import Optional

import click
from sqlalchemy.future import select
from sqlalchemy import func
from sqlalchemy.ext.asyncio import AsyncConnection, create_async_engine

from ee.src.models.db_models import WorkspaceMemberDB as WorkspaceMemberDBE
from oss.src.models.db_models import ProjectDB as ProjectDBE
from oss.src.dbs.postgres.testcases.dbes import (
    TestcaseBlobDBE,
)
from oss.src.dbs.postgres.blobs.dao import BlobsDAO
from oss.src.dbs.postgres.testsets.dbes import (
    TestsetArtifactDBE,
    TestsetVariantDBE,
    TestsetRevisionDBE,
)
from oss.src.dbs.postgres.git.dao import GitDAO
from oss.src.core.testcases.service import TestcasesService
from oss.src.models.deprecated_models import DeprecatedTestsetDB
from oss.src.core.testsets.service import TestsetsService, SimpleTestsetsService


# Define constants
DEFAULT_BATCH_SIZE = 200

# Initialize plug-ins for migration
testcases_dao = BlobsDAO(
    BlobDBE=TestcaseBlobDBE,
)
testsets_dao = GitDAO(
    ArtifactDBE=TestsetArtifactDBE,
    VariantDBE=TestsetVariantDBE,
    RevisionDBE=TestsetRevisionDBE,
)
testcases_service = TestcasesService(
    testcases_dao=testcases_dao,
)
testsets_service = TestsetsService(
    testsets_dao=testsets_dao,
    testcases_service=testcases_service,
)
simple_testsets_service = SimpleTestsetsService(
    testsets_service=testsets_service,
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


async def migration_old_testsets_to_new_testsets(
    connection: AsyncConnection,
):
    """Migrate old testsets to new testsets system."""
    try:
        offset = 0
        total_migrated = 0
        skipped_records = 0

        # Count total rows with a non-null project_id
        total_query = (
            select(func.count())
            .select_from(DeprecatedTestsetDB)
            .filter(DeprecatedTestsetDB.project_id.isnot(None))
        )
        result = await connection.execute(total_query)
        total_rows = result.scalar()
        total_testsets = total_rows or 0

        click.echo(
            click.style(
                f"Total rows in testsets with project_id: {total_testsets}",
                fg="yellow",
            )
        )

        while offset < total_testsets:
            # STEP 1: Fetch evaluator configurations with non-null project_id
            result = await connection.execute(
                select(DeprecatedTestsetDB)
                .filter(DeprecatedTestsetDB.project_id.isnot(None))
                .offset(offset)
                .limit(DEFAULT_BATCH_SIZE)
            )
            testsets_rows = result.fetchall()

            if not testsets_rows:
                break

            # Process and transfer records to testset workflows
            for testset in testsets_rows:
                try:
                    # STEP 2: Get owner from project_id
                    owner = await _fetch_project_owner(
                        project_id=testset.project_id,  # type: ignore
                        connection=connection,
                    )
                    if not owner:
                        skipped_records += 1
                        click.echo(
                            click.style(
                                f"Skipping record with ID {testset.id} due to missing owner in workspace member table",
                                fg="yellow",
                            )
                        )
                        continue

                    # STEP 3: Migrate records using transfer_* util function
                    new_testset = await simple_testsets_service.transfer(
                        project_id=testset.project_id,
                        user_id=owner,
                        testset_id=testset.id,
                    )
                    if not new_testset:
                        skipped_records += 1
                        click.echo(
                            click.style(
                                f"Skipping record with ID {testset.id} due to old testset not existing in database table",
                                fg="yellow",
                            )
                        )
                        continue

                except Exception as e:
                    click.echo(
                        click.style(
                            f"Failed to migrate testset {testset.id}: {str(e)}",
                            fg="red",
                        )
                    )
                    click.echo(click.style(traceback.format_exc(), fg="red"))
                    skipped_records += 1
                    continue

            # Update progress tracking for current batch
            batch_migrated = len(testsets_rows)
            offset += DEFAULT_BATCH_SIZE
            total_migrated += batch_migrated

            click.echo(
                click.style(
                    f"Processed {batch_migrated} records in this batch.",
                    fg="yellow",
                )
            )

        # Update progress tracking for all batches
        remaining_records = total_testsets - total_migrated
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
            await migration_old_testsets_to_new_testsets(connection=connection)

    with concurrent.futures.ThreadPoolExecutor() as executor:
        future = executor.submit(asyncio.run, _start())
        future.result()
