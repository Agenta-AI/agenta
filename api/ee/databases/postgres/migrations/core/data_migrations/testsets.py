import json
import uuid
import asyncio
import traceback
import re
from uuid import UUID, uuid4
from typing import Optional, List, Tuple

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
from oss.src.core.shared.dtos import Reference
from oss.src.core.testcases.dtos import Testcase
from oss.src.core.testcases.service import TestcasesService
from oss.src.models.deprecated_models import DeprecatedTestsetDB
from oss.src.core.testsets.dtos import TestsetRevisionCommit, TestsetRevisionData
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


INPUT_KEYS: Tuple[str, ...] = ("messages",)
OUTPUT_KEYS: Tuple[str, ...] = ("correct_answer",)

CORRECT_ANSWER_LIKE_RE = re.compile(
    r'^\s*\{\s*"content"\s*:\s*".*?"\s*,\s*"role"\s*:\s*".*?"',
    re.DOTALL,
)


def _parse_messages(value) -> Optional[List]:
    """Parse chat/messages into a list where each item has role and content."""
    if isinstance(value, list):
        parsed = value
    else:
        if not isinstance(value, str) or not value.strip().startswith("["):
            return None
        try:
            parsed = json.loads(value)
        except Exception:
            return None

    if not isinstance(parsed, list):
        return None

    if not all(
        isinstance(item, dict) and "role" in item and "content" in item
        for item in parsed
    ):
        return None

    return parsed


def _parse_json_column(value, allowed_types: Tuple[type, ...]) -> Optional[object]:
    """Parse a stringified JSON column into allowed types; returns None if no change."""
    if isinstance(value, allowed_types):
        return None

    if not isinstance(value, str):
        return None

    try:
        parsed = json.loads(value)
    except Exception:
        return None

    if isinstance(parsed, allowed_types):
        return parsed

    return None


def _parse_expected(value) -> Optional[object]:
    """Parse expected/answer fields; must contain role+content."""
    parsed = _parse_json_column(value, (dict, list))
    if parsed is None:
        return None

    if isinstance(parsed, dict):
        return parsed if ("role" in parsed and "content" in parsed) else None

    if isinstance(parsed, list):
        return (
            parsed
            if all(
                isinstance(item, dict) and "role" in item and "content" in item
                for item in parsed
            )
            else None
        )

    return None


def _jsonify_testcase_fields(testcases: Optional[List[Testcase]]) -> bool:
    """
    Mutate testcase.data in-place, converting:
    - chat/messages strings → list
    - expected/ground-truth strings → dict/list (usually dict)
    """
    if not testcases:
        return False

    changed = False
    expected_parsed = False

    for testcase in testcases:
        data = getattr(testcase, "data", None)
        if not isinstance(data, dict):
            continue

        for key in INPUT_KEYS:
            parsed = _parse_messages(data.get(key))
            if parsed is not None:
                data[key] = parsed
                changed = True

        for key in OUTPUT_KEYS:
            parsed = _parse_expected(data.get(key))
            if parsed is not None:
                data[key] = parsed
                changed = True
                expected_parsed = True

        if not expected_parsed:
            for field_key, value in data.items():
                if not isinstance(value, str):
                    continue
                if not CORRECT_ANSWER_LIKE_RE.match(value):
                    continue

                parsed = _parse_expected(value)
                if parsed is not None:
                    data[field_key] = parsed
                    changed = True
                    expected_parsed = True
                    break

    return changed


async def _commit_jsonified_revision(
    *,
    project_id: UUID,
    user_id: UUID,
    testset_id: UUID,
) -> bool:
    """
    Fetch latest revision for the given testset and, if chat/expected columns are stringified,
    commit a new revision with jsonified data.
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

    if not _jsonify_testcase_fields(testcases):
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
            result = await connection.execute(
                select(DeprecatedTestsetDB)
                .filter(DeprecatedTestsetDB.project_id.isnot(None))
                .offset(offset)
                .limit(DEFAULT_BATCH_SIZE)
            )
            testsets_rows = result.fetchall()

            if not testsets_rows:
                break

            for testset in testsets_rows:
                try:
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

            batch_migrated = len(testsets_rows)
            offset += DEFAULT_BATCH_SIZE
            total_migrated += batch_migrated

            click.echo(
                click.style(
                    f"Processed {batch_migrated} records in this batch.",
                    fg="yellow",
                )
            )

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
