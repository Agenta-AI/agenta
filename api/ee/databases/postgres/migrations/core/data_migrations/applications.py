import uuid
import traceback
from typing import Dict, List


import click
from sqlalchemy.future import select
from sqlalchemy import delete, Connection, update, func

from oss.src.models.deprecated_models import (  # type: ignore
    DeprecatedEvaluatorConfigDBwApp as DeprecatedEvaluatorConfigDB,
    DeprecatedAppDB,
)


BATCH_SIZE = 200


def get_app_names_batch(
    session: Connection, app_ids: List[uuid.UUID]
) -> Dict[uuid.UUID, str]:
    """Fetch app names for multiple app_ids in a single query."""
    if not app_ids:
        return {}
    query = session.execute(
        select(DeprecatedAppDB.id, DeprecatedAppDB.app_name).filter(
            DeprecatedAppDB.id.in_(app_ids)
        )
    )
    return {row.id: row.app_name for row in query.fetchall()}


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

            # Collect unique app_ids from this batch
            unique_app_ids = list(
                {record.app_id for record in records if record.app_id is not None}
            )

            # Batch fetch all app names in a single query
            app_names = get_app_names_batch(session, unique_app_ids)

            # Build list of updates for batch execution
            updates_to_apply: List[Dict] = []
            batch_skipped = 0

            for record in records:
                if record.app_id is None:
                    print(
                        f"Skipping... evaluator_config {str(record.id)} have app_id that is NULL."
                    )
                    batch_skipped += 1
                    continue

                app_name = app_names.get(record.app_id)
                if app_name is not None:
                    new_name = f"{record.name} ({app_name})"
                    updates_to_apply.append({"id": record.id, "name": new_name})
                else:
                    print(
                        f"Skipping... No application found for evaluator_config {str(record.id)}."
                    )
                    batch_skipped += 1

            # Execute bulk update using bindparam for efficiency
            if updates_to_apply:
                from sqlalchemy import bindparam

                stmt = (
                    update(DeprecatedEvaluatorConfigDB)
                    .where(DeprecatedEvaluatorConfigDB.id == bindparam("id"))
                    .values(name=bindparam("name"))
                )
                session.execute(stmt, updates_to_apply)

            session.commit()

            SKIPPED_RECORDS += batch_skipped

            # Update progress tracking
            batch_migrated = len(records)
            batch_updated = len(updates_to_apply)
            TOTAL_MIGRATED += batch_migrated
            offset += BATCH_SIZE
            remaining_records = TOTAL_EVALUATOR_CONFIGS - TOTAL_MIGRATED
            click.echo(
                click.style(
                    f"Processed {batch_migrated} records ({batch_updated} updated, {batch_skipped} skipped). "
                    f"Total: {TOTAL_MIGRATED}. Remaining: {remaining_records}",
                    fg="yellow",
                )
            )

            # Break if all records have been processed
            if remaining_records <= 0:
                break

        # Delete deprecated evaluator configs with app_id as None
        stmt = (
            select(func.count())
            .select_from(DeprecatedEvaluatorConfigDB)
            .filter(DeprecatedEvaluatorConfigDB.app_id.is_(None))
        )
        result = session.execute(stmt).scalar()
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
