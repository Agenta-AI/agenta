import uuid
import traceback
from typing import Optional

import click
from sqlalchemy.future import select
from sqlalchemy import Connection, update, func, or_, insert, delete

from oss.src.models.db_models import APIKeyDB
from ee.src.models.db_models import ProjectDB
from ee.src.models.extended.deprecated_models import DeprecatedAPIKeyDB


BATCH_SIZE = 200


def get_project_id_from_workspace_id(
    session: Connection, workspace_id: str
) -> Optional[str]:
    statement = select(ProjectDB).filter_by(
        workspace_id=uuid.UUID(workspace_id), is_default=True
    )
    project = session.execute(statement).fetchone()
    return str(project.id) if project is not None else None


def get_workspace_id_from_project_id(
    session: Connection, project_id: str
) -> Optional[str]:
    statement = select(ProjectDB).filter_by(id=uuid.UUID(project_id))
    project = session.execute(statement).fetchone()
    return str(project.workspace_id) if project is not None else None


def update_api_key_to_make_use_of_project_id(session: Connection):
    try:
        offset = 0
        TOTAL_MIGRATED = 0
        SKIPPED_RECORDS = 0

        # Count total rows with user_id & workspace_id isnot NULL & project_id is NULL
        total_query = (
            select(func.count())
            .select_from(DeprecatedAPIKeyDB)
            .filter(
                DeprecatedAPIKeyDB.user_id.isnot(None),
                DeprecatedAPIKeyDB.workspace_id.isnot(None),
                DeprecatedAPIKeyDB.project_id.is_(None),
            )
        )
        result = session.execute(total_query).scalar()
        TOTAL_API_KEYS_WITH_USER_AND_WORKSPACE_ID = result if result is not None else 0
        print(
            f"Total rows in api_keys table with user_id and workspace_id not been NULL is {TOTAL_API_KEYS_WITH_USER_AND_WORKSPACE_ID}"
        )

        while True:
            # Fetch a batch of api_keys with user_id and workspace_id not been NULL
            records = session.execute(
                select(DeprecatedAPIKeyDB)
                .filter(
                    or_(
                        DeprecatedAPIKeyDB.user_id.isnot(None),
                        DeprecatedAPIKeyDB.user_id != "None",
                    ),
                    or_(
                        DeprecatedAPIKeyDB.workspace_id != "None",
                        DeprecatedAPIKeyDB.workspace_id.isnot(None),
                    ),
                    DeprecatedAPIKeyDB.project_id.is_(None),
                )
                .offset(offset)
                .limit(BATCH_SIZE)
            ).fetchall()
            batch_migrated = len(records)
            if not records:
                break

            # Process and update records in the batch
            for record in records:
                print(
                    "Record (has workspace_id?, workspace id, user id, id, types [workspace_id & user_id]) --- ",
                    hasattr(record, "workspace_id"),
                    record.workspace_id,
                    record.user_id,
                    record.id,
                    type(record.workspace_id),
                    type(record.user_id),
                )
                if (
                    hasattr(record, "workspace_id")
                    and record.workspace_id
                    not in [
                        "None",
                        "",
                    ]
                    and record.user_id not in ["None", ""]
                ):
                    project_id = get_project_id_from_workspace_id(
                        session=session, workspace_id=str(record.workspace_id)
                    )
                    if project_id is None:
                        SKIPPED_RECORDS += 1
                        print(
                            f"Could not retrieve project_id from workspace_id for APIKey with ID {str(record.id)}."
                        )

                        batch_migrated -= 1
                        print(
                            "Subtracting record from part of batch. Now,  Skipping record..."
                        )
                        continue

                    # Add the new object to the session.
                    insert_statement = insert(APIKeyDB).values(
                        prefix=record.prefix,
                        hashed_key=record.hashed_key,
                        created_by_id=uuid.UUID(record.user_id),
                        project_id=uuid.UUID(project_id),
                        rate_limit=record.rate_limit,
                        hidden=record.hidden,
                        expiration_date=record.expiration_date,
                        created_at=record.created_at,
                        updated_at=record.updated_at,
                    )
                    session.execute(insert_statement)
                else:
                    SKIPPED_RECORDS += 1
                    print(
                        f"No workspace_id found for APIKey with ID {str(record.id)}. Skipping record..."
                    )

                    batch_migrated -= 1
                    print(
                        "Subtracting record from part of batch. Now,  Skipping record..."
                    )
                    continue

            # Update migration progress tracking
            TOTAL_MIGRATED += batch_migrated
            offset += BATCH_SIZE
            remaining_records = (
                TOTAL_API_KEYS_WITH_USER_AND_WORKSPACE_ID - TOTAL_MIGRATED
            )
            click.echo(
                click.style(
                    f"Processed {batch_migrated} records in this batch. Total records migrated: {TOTAL_MIGRATED}. Records left to migrate: {remaining_records}.",
                    fg="yellow",
                )
            )

            # Break if all records have been processed
            if remaining_records <= 0:
                break

        # Count total rows with user_id and/or workspace_id been NULL
        query = (
            select(func.count())
            .select_from(DeprecatedAPIKeyDB)
            .filter(DeprecatedAPIKeyDB.project_id.is_(None))
        )
        result = session.execute(query).scalar()
        TOTAL_API_KEYS_WITH_NO_USER_AND_WORKSPACE_ID = (
            result if result is not None else 0
        )
        if TOTAL_API_KEYS_WITH_NO_USER_AND_WORKSPACE_ID >= 1:
            session.execute(
                delete(DeprecatedAPIKeyDB).where(
                    DeprecatedAPIKeyDB.project_id.is_(None)
                )
            )

        print(
            f"Total rows in api_keys table with user_id and workspace_id been NULL is {TOTAL_API_KEYS_WITH_NO_USER_AND_WORKSPACE_ID} and have been deleted."
        )
    except Exception as e:
        session.rollback()
        click.echo(
            click.style(
                f"ERROR updating api_keys to make use of project_id: {traceback.format_exc()}",
                fg="red",
            )
        )
        raise e


def revert_api_key_to_make_use_of_workspace_id(session: Connection):
    try:
        offset = 0
        TOTAL_MIGRATED = 0
        SKIPPED_RECORDS = 0

        # Count total rows with created_by_id & project_id isnot NULL
        total_query = (
            select(func.count())
            .select_from(DeprecatedAPIKeyDB)
            .filter(
                DeprecatedAPIKeyDB.created_by_id.isnot(None),
                DeprecatedAPIKeyDB.project_id.isnot(None),
                DeprecatedAPIKeyDB.workspace_id.is_(None),
            )
        )
        result = session.execute(total_query).scalar()
        TOTAL_API_KEYS_WITH_USER_AND_PROJECT_ID = result if result is not None else 0
        print(
            f"Total rows in api_keys table with created_by_id and project_id not been NULL is {TOTAL_API_KEYS_WITH_USER_AND_PROJECT_ID}"
        )

        while True:
            # Fetch a batch of api_keys with created_by_id & project_id isnot NULL
            records = session.execute(
                select(DeprecatedAPIKeyDB)
                .filter(
                    DeprecatedAPIKeyDB.created_by_id.isnot(None),
                    DeprecatedAPIKeyDB.project_id.isnot(None),
                    DeprecatedAPIKeyDB.workspace_id.is_(None),
                )
                .offset(offset)
                .limit(BATCH_SIZE)
            ).fetchall()

            if not records or len(records) <= 0:
                break  # Exit if no more records to process

            # Process and update records in the batch
            for record in records:
                workspace_id = get_workspace_id_from_project_id(
                    session=session, project_id=str(record.project_id)
                )
                if workspace_id is None:
                    SKIPPED_RECORDS += 1
                    print(
                        f"Could not retrieve workspace_id from project_id for APIKey with ID {str(record.id)}. Skipping record..."
                    )
                    continue

                session.execute(
                    update(DeprecatedAPIKeyDB)
                    .where(DeprecatedAPIKeyDB.id == record.id)
                    .values(
                        user_id=str(record.created_by_id),
                        workspace_id=workspace_id,
                    )
                )

            # Update migration progress tracking
            batch_migrated = len(records)
            TOTAL_MIGRATED += batch_migrated
            offset += BATCH_SIZE
            remaining_records = TOTAL_API_KEYS_WITH_USER_AND_PROJECT_ID - TOTAL_MIGRATED
            click.echo(
                click.style(
                    f"Processed {batch_migrated} records in this batch. Total records migrated: {TOTAL_MIGRATED}. Records left to migrate: {remaining_records}.",
                    fg="yellow",
                )
            )

        # Count total rows with created_by_id and/or project_id been NULL
        query = (
            select(func.count())
            .select_from(DeprecatedAPIKeyDB)
            .filter(
                or_(
                    DeprecatedAPIKeyDB.created_by_id.is_(None),
                    DeprecatedAPIKeyDB.project_id.is_(None),
                ),
            )
        )
        result = session.execute(query).scalar()
        TOTAL_API_KEYS_WITH_NO_USER_AND_PROJECT_ID = result if result is not None else 0
        print(
            f"Total rows in api_keys table with created_by_id and project_id been NULL is {TOTAL_API_KEYS_WITH_NO_USER_AND_PROJECT_ID}"
        )
    except Exception as e:
        session.rollback()
        click.echo(
            click.style(
                f"ERROR reverting api_keys to make use of workspace_id: {traceback.format_exc()}",
                fg="red",
            )
        )
        raise e
