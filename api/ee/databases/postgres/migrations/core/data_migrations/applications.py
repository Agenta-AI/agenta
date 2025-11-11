import uuid
import traceback
from typing import Optional


import click
from sqlalchemy.future import select
from sqlalchemy import delete, Connection, update, func

from oss.src.models.deprecated_models import (  # type: ignore
    DeprecatedEvaluatorConfigDBwApp as DeprecatedEvaluatorConfigDB,
    DeprecatedAppDB,
)


BATCH_SIZE = 200


def get_app_db(session: Connection, app_id: str) -> Optional[DeprecatedAppDB]:
    query = session.execute(select(DeprecatedAppDB).filter_by(id=uuid.UUID(app_id)))
    return query.fetchone()  # type: ignore


def update_evaluators_with_app_name(session: Connection):
    try:
        offset = 0
        TOTAL_MIGRATED = 0
        SKIPPED_RECORDS = 0

        # Count total rows with a non-null app_id
        total_query = (
            select(func.count())
            .select_from(DeprecatedEvaluatorConfigDB)
            .filter(DeprecatedEvaluatorConfigDB.app_id.isnot(None))
        )
        result = session.execute(total_query).scalar()
        TOTAL_EVALUATOR_CONFIGS = result if result is not None else 0
        print(
            f"Total rows in evaluator_configs table with app_id: {TOTAL_EVALUATOR_CONFIGS}"
        )

        while True:
            # Fetch a batch of evaluator_configs with non-null app_id
            records = session.execute(
                select(DeprecatedEvaluatorConfigDB)
                .filter(DeprecatedEvaluatorConfigDB.app_id.isnot(None))
                .offset(offset)
                .limit(BATCH_SIZE)
            ).fetchall()
            if not records:
                break

            # Process and update records in the batch
            for record in records:
                if hasattr(record, "app_id") and record.app_id is not None:
                    evaluator_config_app = get_app_db(
                        session=session, app_id=str(record.app_id)
                    )
                    if evaluator_config_app is not None:
                        # Update the name with the app_name as a prefix
                        new_name = f"{record.name} ({evaluator_config_app.app_name})"
                        session.execute(
                            update(DeprecatedEvaluatorConfigDB)
                            .where(DeprecatedEvaluatorConfigDB.id == record.id)
                            .values(name=new_name)
                        )
                    else:
                        print(
                            f"Skipping... No application found for evaluator_config {str(record.id)}."
                        )
                        SKIPPED_RECORDS += 1
                else:
                    print(
                        f"Skipping... evaluator_config {str(record.id)} have app_id that is NULL."
                    )
                    SKIPPED_RECORDS += 1

            session.commit()

            # Update progress tracking
            batch_migrated = len(records)
            TOTAL_MIGRATED += batch_migrated
            offset += BATCH_SIZE
            remaining_records = TOTAL_EVALUATOR_CONFIGS - TOTAL_MIGRATED
            click.echo(
                click.style(
                    f"Processed {batch_migrated} records in this batch. Total records migrated: {TOTAL_MIGRATED}. Records left to migrate: {remaining_records}",
                    fg="yellow",
                )
            )

            # Break if all records have been processed
            if remaining_records <= 0:
                break

        # Delete deprecated evaluator configs with app_id as None
        query = (
            select(func.count())
            .select_from(DeprecatedEvaluatorConfigDB)
            .filter(DeprecatedEvaluatorConfigDB.app_id.is_(None))
        )
        result = session.execute(query).scalar()
        TOTAL_EVALUATOR_CONFIGS_WITH_NO_APPID = result if result is not None else 0
        print(
            f"Total rows in evaluator_configs table with no app_id: {TOTAL_EVALUATOR_CONFIGS_WITH_NO_APPID}. Deleting these rows..."
        )

        session.execute(
            delete(DeprecatedEvaluatorConfigDB).where(
                DeprecatedEvaluatorConfigDB.app_id.is_(None)
            )
        )
        session.commit()
        print("Successfully deleted rows in evaluator_configs with no app_id.")

    except Exception as e:
        session.rollback()
        click.echo(
            click.style(
                f"ERROR updating evaluator config names: {traceback.format_exc()}",
                fg="red",
            )
        )
        raise e
