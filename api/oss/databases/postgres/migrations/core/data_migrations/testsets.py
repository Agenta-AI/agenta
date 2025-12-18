import json
import uuid
import asyncio
import traceback
from uuid import UUID, uuid4
from typing import Optional, List

import click
from sqlalchemy.future import select
from sqlalchemy import func
from sqlalchemy.ext.asyncio import AsyncConnection, create_async_engine

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
from oss.src.core.shared.dtos import Reference
from oss.src.core.testcases.dtos import Testcase
from oss.src.core.testcases.service import TestcasesService
from oss.src.core.testsets.dtos import TestsetRevisionCommit, TestsetRevisionData
from oss.src.core.testsets.service import TestsetsService, SimpleTestsetsService
from oss.src.models.deprecated_models import (
    DeprecatedTestsetDB,
    DeprecatedOrganizationDB,
)


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


def _parse_chat_column(value) -> Optional[List]:
    """Parse a stringified chat/messages column into a list, otherwise None."""
    if isinstance(value, list):
        return None

    if not isinstance(value, str):
        return None

    try:
        parsed = json.loads(value)
    except Exception:
        return None

    if isinstance(parsed, list):
        return parsed

    return None


def _jsonify_chat_columns(testcases: Optional[List[Testcase]]) -> bool:
    """Mutate testcase.data in-place, converting stringified chat/messages to lists."""
    if not testcases:
        return False

    changed = False

    for testcase in testcases:
        data = getattr(testcase, "data", None)
        if not isinstance(data, dict):
            continue

        for key in ("messages", "chat"):
            parsed = _parse_chat_column(data.get(key))
            if parsed is not None:
                data[key] = parsed
                changed = True

    return changed


async def _commit_jsonified_revision(
    *,
    project_id: UUID,
    user_id: UUID,
    testset_id: UUID,
) -> bool:
    """
    Fetch latest revision for the given testset and, if chat columns are stringified,
    commit a new revision with jsonified chat/messages.
    """
    testset_variant = await testsets_service.fetch_testset_variant(
        project_id=project_id,
        testset_ref=Reference(id=testset_id),
    )

    if not testset_variant:
        return False

    testset_revision = await testsets_service.fetch_testset_revision(
        project_id=project_id,
        testset_variant_ref=Reference(id=testset_variant.id),
    )

    if (
        not testset_revision
        or not testset_revision.data
        or not testset_revision.data.testcases
    ):
        return False

    testcases: List[Testcase] = testset_revision.data.testcases or []

    if not _jsonify_chat_columns(testcases):
        return False

    testset_revision_slug = uuid4().hex[-12:]

    testset_revision_commit = TestsetRevisionCommit(
        slug=testset_revision_slug,
        #
        name=testset_revision.name,
        description=testset_revision.description,
        #
        tags=testset_revision.tags,
        meta=testset_revision.meta,
        flags=testset_revision.flags,
        #
        data=TestsetRevisionData(
            testcases=testcases,
        ),
        #
        testset_id=testset_variant.testset_id,
        testset_variant_id=testset_variant.id,
    )

    committed_revision = await testsets_service.commit_testset_revision(
        project_id=project_id,
        user_id=user_id,
        #
        testset_revision_commit=testset_revision_commit,
    )

    if not committed_revision:
        return False

    click.echo(
        click.style(
            f"Committed jsonified chat/messages revision for testset {testset_id}",
            fg="green",
        )
    )

    return True


async def migration_old_testsets_to_new_testsets(
    connection: AsyncConnection,
):
    """Migrate old testsets to new testsets system."""
    try:
        offset = 0
        total_migrated = 0
        skipped_records = 0
        chat_jsonified = 0

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

                    # STEP 4: If latest revision has stringified chat/messages, json-ify and commit
                    try:
                        jsonified = await _commit_jsonified_revision(
                            project_id=testset.project_id,
                            user_id=owner,
                            testset_id=testset.id,
                        )
                        if jsonified:
                            chat_jsonified += 1
                    except Exception as e:
                        click.echo(
                            click.style(
                                f"Failed to jsonify chat/messages for testset {testset.id}: {str(e)}",
                                fg="red",
                            )
                        )
                        click.echo(click.style(traceback.format_exc(), fg="red"))

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
        click.echo(
            click.style(
                f"Revisions jsonified (chat/messages): {chat_jsonified}",
                fg="yellow",
            )
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
