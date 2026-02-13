import uuid
import traceback
from typing import Dict, Optional
from collections import defaultdict

import click
from sqlalchemy.future import select
from sqlalchemy import Connection, update, func, or_

from ee.src.models.extended.deprecated_transfer_models import (  # type: ignore
    ProjectDB,
    AppDB,
    AppVariantDB,
    AppVariantRevisionsDB,
    VariantBaseDB,
    DeploymentDB,
    AppEnvironmentDB,
    AppEnvironmentRevisionDB,
    EvaluationScenarioDB,
    EvaluationDB,
    EvaluatorConfigDB,
    HumanEvaluationDB,
    HumanEvaluationScenarioDB,
    TestsetDB,
)


MODELS = [
    AppDB,  # have workspace_id
    AppVariantDB,  # have workspace_id
    AppVariantRevisionsDB,  # doesn't have, but can make use of variant_id to get workspace_id
    VariantBaseDB,  # have workspace_id
    DeploymentDB,  # have workspace_id
    AppEnvironmentDB,  # have workspace_id
    AppEnvironmentRevisionDB,  # have workspace_id
    EvaluationScenarioDB,  # have workspace_id
    EvaluationDB,  # have workspace_id
    EvaluatorConfigDB,  # have workspace_id
    HumanEvaluationDB,  # have workspace_id
    HumanEvaluationScenarioDB,  # have workspace_id
    TestsetDB,  # have workspace_id
]


def get_workspace_project_by_id(
    session: Connection, workspace_id: str
) -> Optional[str]:
    workspace_project = session.execute(
        select(ProjectDB).filter_by(
            is_default=True, workspace_id=uuid.UUID(workspace_id)
        )
    ).fetchone()
    return str(workspace_project.id) if workspace_project is not None else None


def get_variant_by_id(session: Connection, variant_id: str) -> Optional[AppVariantDB]:
    query = session.execute(select(AppVariantDB).filter_by(id=uuid.UUID(variant_id)))
    return query.fetchone()  # type: ignore


def get_app_by_id(session: Connection, app_id: str) -> Optional[AppDB]:
    query = session.execute(select(AppDB).filter_by(id=uuid.UUID(app_id)))
    return query.fetchone()  # type: ignore


def get_evaluation_by_id(
    session: Connection, evaluation_id: str
) -> Optional[EvaluationDB]:
    query = session.execute(select(EvaluationDB).filter_by(id=uuid.UUID(evaluation_id)))
    return query.fetchone()  # type: ignore


def get_workspace_project_id(session: Connection, workspace_id: str) -> Optional[str]:
    query = session.execute(
        select(ProjectDB).filter_by(
            workspace_id=uuid.UUID(workspace_id), is_default=True
        )
    )
    workspace_project = query.fetchone()
    return str(workspace_project.id) if workspace_project is not None else None


def repair_evaluation_scenario_to_have_project_id(session: Connection):
    offset = 0
    BATCH_SIZE = 200
    TOTAL_MIGRATED = 0

    # Count total rows for evaluation_scenarios with project_id = None
    count_query = (
        select(func.count())
        .select_from(EvaluationScenarioDB)
        .filter(EvaluationScenarioDB.project_id.is_(None))
    )
    result = session.execute(count_query).scalar()
    TOTAL_ROWS_OF_TABLE = result if result is not None else 0
    print(
        f"\nTotal rows in {EvaluationScenarioDB.__tablename__} table with no workspace_id: {TOTAL_ROWS_OF_TABLE}. Repairing rows to make use of workspace_id from either variant_id or evaluation_id..."
    )

    while True:
        # Fetch records where project_id is None
        records = session.execute(
            select(EvaluationScenarioDB)
            .filter(
                EvaluationScenarioDB.project_id.is_(None),
                or_(
                    EvaluationScenarioDB.variant_id.isnot(None),
                    EvaluationScenarioDB.evaluation_id.isnot(None),
                ),
            )
            .limit(BATCH_SIZE)
        ).fetchall()

        # If no more records are returned, break the loop
        if not records or len(records) == 0:
            break

        # Update records with default project_id
        for record in records:
            workspace_id = None

            if hasattr(record, "variant_id") and record.variant_id is not None:
                variant = get_variant_by_id(
                    session=session, variant_id=str(record.variant_id)
                )
                if variant is None:
                    print(
                        f"ES {str(record.id)} did not return any variant to retrieve the workspace_id. Now, trying evaluation..."
                    )
                else:
                    workspace_id = str(variant.workspace_id)

            if (
                workspace_id is None
                and hasattr(record, "evaluation_id")
                and record.evaluation_id is not None
            ):
                evaluation = get_evaluation_by_id(
                    session=session, evaluation_id=str(record.evaluation_id)
                )
                if evaluation is None:
                    print(
                        f"ES {str(record.id)} did not return any evaluation or variant to retrieve the workspace_id. Skipping record..."
                    )
                    continue  # Skip this record as no valid workspace_id found

                workspace_id = str(evaluation.workspace_id)

            # Update model record workspace_id field if a valid project_id was found
            if workspace_id is not None:
                workspace_project_id = get_workspace_project_by_id(
                    session=session, workspace_id=workspace_id
                )
                session.execute(
                    update(EvaluationScenarioDB)
                    .where(EvaluationScenarioDB.id == record.id)
                    .values(project_id=uuid.UUID(workspace_project_id))
                )
            else:
                print(
                    f"Evaluation scenario {str(record.id)} did not find a variant_id {record.variant_id} and evaluation {record.evaluation_id} to make use of."
                )

        session.commit()

        # Update migration progress
        batch_migrated = len(records)
        TOTAL_MIGRATED += batch_migrated
        offset += batch_migrated
        remaining_records = TOTAL_ROWS_OF_TABLE - TOTAL_MIGRATED
        click.echo(
            click.style(
                f"Processed {batch_migrated} records in this batch. Total records migrated: {TOTAL_MIGRATED}. Records left to migrate: {remaining_records}",
                fg="yellow",
            )
        )

        # Break if all records have been processed
        records_with_no_variant_and_workspace_count_query = (
            select(func.count())
            .select_from(EvaluationScenarioDB)
            .filter(
                EvaluationScenarioDB.project_id.is_(None),
                EvaluationScenarioDB.evaluation_id.is_(None),
                EvaluationScenarioDB.variant_id.is_(None),
            )
        )
        result = session.execute(
            records_with_no_variant_and_workspace_count_query
        ).scalar()
        UNREPAIRABLE_DATA = result if result is not None else 0
        click.echo(
            click.style(
                f"Total malformed records with no variant_id & evaluation_id: {UNREPAIRABLE_DATA}",
                fg="yellow",
            )
        )

    # Final reporting
    click.echo(
        click.style(
            "Migration to repair evaluation_scenario to have project_id completed.",
            fg="green",
        )
    )


def repair_evaluator_configs_to_have_project_id(session: Connection):
    offset = 0
    BATCH_SIZE = 200
    TOTAL_MIGRATED = 0
    SKIPPED_RECORDS = 0

    # Count total rows for evaluator_configs with workspace_id = None
    count_query = (
        select(func.count())
        .select_from(EvaluatorConfigDB)
        .filter(EvaluatorConfigDB.project_id.is_(None))
    )
    result = session.execute(count_query).scalar()
    TOTAL_ROWS_OF_TABLE = result if result is not None else 0
    print(
        f"\nTotal rows in {EvaluatorConfigDB.__tablename__} table with no workspace_id: {TOTAL_ROWS_OF_TABLE}. Repairing rows to make use of workspace_id from app..."
    )

    while True:
        # Fetch records where project_id is None
        records = session.execute(
            select(EvaluatorConfigDB)
            .filter(EvaluatorConfigDB.project_id.is_(None))
            .limit(BATCH_SIZE)
        ).fetchall()

        # Update records with default project_id
        for record in records:
            workspace_id = None

            if hasattr(record, "app_id") and (
                record.app_id is None or record.app_id == ""
            ):
                print(f"Evaluator config {str(record.id)} have no app_id. Skipping...")
                SKIPPED_RECORDS += 1
                continue

            if hasattr(record, "app_id") and record.app_id is not None:
                app_db = get_app_by_id(session=session, app_id=str(record.app_id))
                if app_db is None:
                    print(
                        f"Evaluator config {str(record.id)} have an app_id, but no application was found with the ID. Skipping..."
                    )
                    SKIPPED_RECORDS += 1
                    continue

                workspace_id = str(app_db.workspace_id)

            # Update model record workspace_id field if a valid project_id was found
            if workspace_id is not None:
                workspace_project_id = get_workspace_project_by_id(
                    session=session, workspace_id=workspace_id
                )
                session.execute(
                    update(EvaluatorConfigDB)
                    .where(EvaluatorConfigDB.id == record.id)
                    .values(project_id=uuid.UUID(workspace_project_id))
                )
            else:
                print(
                    f"Evaluator config {str(record.id)} did not find a workspace_id to make use of."
                )

        session.commit()

        # Update migration progress
        batch_migrated = len(records)
        TOTAL_MIGRATED += batch_migrated
        offset += batch_migrated
        remaining_records = TOTAL_ROWS_OF_TABLE - TOTAL_MIGRATED
        click.echo(
            click.style(
                f"Processed {batch_migrated} records in this batch. Total records migrated: {TOTAL_MIGRATED}. Records left to migrate: {remaining_records}",
                fg="yellow",
            )
        )

        # Break if all records have been processed
        if batch_migrated <= 0:
            break

    records_with_no_project_id = (
        select(func.count())
        .select_from(EvaluatorConfigDB)
        .filter(EvaluatorConfigDB.project_id.is_(None))
    )
    result = session.execute(records_with_no_project_id).scalar()
    TOTAL_ROWS_OF_RECORDS_WITH_NO_PROJECT_ID = result if result is not None else 0

    # Final reporting
    click.echo(
        click.style(
            f"Migration to repair evaluator_configs to have project_id completed. Total records with no project_id: {TOTAL_ROWS_OF_RECORDS_WITH_NO_PROJECT_ID}",
            fg="green",
        )
    )


def add_project_id_to_db_entities(session: Connection):
    try:
        for model in MODELS:
            offset = 0
            BATCH_SIZE = 200
            TOTAL_MIGRATED = 0
            SKIPPED_RECORDS: Dict[str, int] = defaultdict(int)

            def update_skipped_records_counter(model_tablename: str):
                if SKIPPED_RECORDS.get(model_tablename, None) is None:
                    SKIPPED_RECORDS[model_tablename] = 1
                else:
                    SKIPPED_RECORDS[model_tablename] += 1

            # Count total rows for tables with project_id = None
            count_query = (
                select(func.count())
                .select_from(model)
                .filter(model.project_id.is_(None))
            )
            result = session.execute(count_query).scalar()
            TOTAL_ROWS_OF_TABLE = result if result is not None else 0
            print(f"Total rows in {model.__tablename__} table is {TOTAL_ROWS_OF_TABLE}")

            if hasattr(model, "workspace_id"):
                query = select(model).filter(
                    model.project_id.is_(None), model.workspace_id.isnot(None)
                )
            else:
                # this will only be applied for AppVariantRevisionsDB model
                query = select(model).filter(model.project_id.is_(None))

            while True:
                # Fetch records where project_id is None and workspace_id is not None
                records = session.execute(query.limit(BATCH_SIZE)).fetchall()
                actual_batch_size = len(records)

                # Add debugging logs for each batch
                click.echo(
                    click.style(
                        f"Fetching {actual_batch_size} records starting from offset {offset} in {model.__tablename__}.",
                        fg="blue",
                    )
                )

                # Update records with default project_id
                for record in records:
                    if hasattr(record, "workspace_id"):
                        workspace_project_id = get_workspace_project_id(
                            session=session, workspace_id=str(record.workspace_id)
                        )
                    elif (
                        hasattr(record, "variant_id") and record.variant_id is not None
                    ) and not hasattr(
                        record, "workspace_id"
                    ):  # this will only be applied for AppVariantRevisionsDB model
                        variant = get_variant_by_id(
                            session=session, variant_id=str(record.variant_id)
                        )
                        if variant is not None:
                            workspace_project_id = get_workspace_project_id(
                                session=session, workspace_id=str(variant.workspace_id)
                            )
                        else:
                            print(
                                f"Skipping record... {str(record.id)} in {model.__tablename__} table did not return any variant {str(record.variant_id)}."
                            )
                            update_skipped_records_counter(
                                model_tablename=model.__tablename__
                            )
                            workspace_project_id = None
                    else:
                        print(
                            f"Skipping record... {str(record.id)} in {model.__tablename__} table due to no variant_id / workspace_id"
                        )
                        actual_batch_size -= 1  # remove malformed record from records
                        update_skipped_records_counter(
                            model_tablename=model.__tablename__
                        )
                        workspace_project_id = None

                    if workspace_project_id is not None:
                        # Update model record project_id field
                        session.execute(
                            update(model)
                            .where(model.id == record.id)
                            .values(project_id=uuid.UUID(workspace_project_id))
                        )

                session.commit()

                # Update migration progress
                TOTAL_MIGRATED += actual_batch_size
                offset += actual_batch_size
                remaining_records = TOTAL_ROWS_OF_TABLE - TOTAL_MIGRATED
                click.echo(
                    click.style(
                        f"Processed {actual_batch_size} records in this batch. Total records migrated: {TOTAL_MIGRATED}. Records left to migrate: {remaining_records}",
                        fg="yellow",
                    )
                )

                # Stop the loop when all records have been processed
                if actual_batch_size <= 0:
                    break

        # Run migration to 'repair' evaluation_scenario to make use of workspace_id from either evalution or variant to get project_id
        repair_evaluation_scenario_to_have_project_id(session=session)

        # Run migration to 'repair' evaluator_configs to make use of workspace_id from app to get project_id
        repair_evaluator_configs_to_have_project_id(session=session)

        click.echo(
            click.style(
                f"Migration for adding project_id to all records listed in {[model.__tablename__ for model in MODELS]} tables are completed. Skipped records: {SKIPPED_RECORDS}",
                fg="green",
            )
        )

    except Exception as e:
        session.rollback()
        click.echo(
            click.style(
                f"ERROR adding project_id to db entities: {traceback.format_exc()}",
                fg="red",
            )
        )
        raise e


def remove_project_id_from_db_entities(session: Connection):
    try:
        for model in MODELS:
            offset = 0
            BATCH_SIZE = 200
            TOTAL_MIGRATED = 0

            # Count total rows for tables where project_id is not None
            count_query = (
                select(func.count())
                .select_from(model)
                .where(model.project_id.isnot(None))
            )
            result = session.execute(count_query).scalar()
            TOTAL_ROWS_OF_TABLE = result if result is not None else 0
            print(f"Total rows in {model.__tablename__} table is {TOTAL_ROWS_OF_TABLE}")

            while True:
                # Retrieve records from model where its project_id is not None
                records = session.execute(
                    select(model)
                    .where(model.project_id.isnot(None))
                    .offset(offset)
                    .limit(BATCH_SIZE)
                ).fetchall()
                actual_batch_size = len(records)
                if not records:
                    break

                # Update records project_id column with None
                for record in records:
                    record.project_id = None

                session.commit()

                # Update migration progress
                TOTAL_MIGRATED += actual_batch_size
                offset += actual_batch_size
                remaining_records = TOTAL_ROWS_OF_TABLE - TOTAL_MIGRATED
                click.echo(
                    click.style(
                        f"Processed {actual_batch_size} records in this batch. Total records migrated: {TOTAL_MIGRATED}. Records left to migrate: {remaining_records}",
                        fg="yellow",
                    )
                )

                # Stop the loop when all records have been processed
                if remaining_records <= 0:
                    break

        click.echo(
            click.style(
                f"Migration for removing project_id to all records listed in {[model.__tablename__ for model in MODELS]} tables are completed.",
                fg="green",
            )
        )

    except Exception as e:
        session.rollback()
        click.echo(
            click.style(
                f"ERROR removing project_id to db entities: {traceback.format_exc()}",
                fg="red",
            )
        )
        raise e
