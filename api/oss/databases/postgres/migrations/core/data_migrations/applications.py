import uuid
import traceback
from typing import Dict, List


import click
from oss.src.utils.env import env
from sqlalchemy.future import select
from sqlalchemy import create_engine, delete, func
from sqlalchemy.orm import sessionmaker, Session

from oss.src.models.deprecated_models import (
    DeprecatedEvaluatorConfigDBwApp as DeprecatedEvaluatorConfigDB,
    DeprecatedAppDB,
)


BATCH_SIZE = 200


def get_app_names_batch(
    session: Session, app_ids: List[uuid.UUID]
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


def update_evaluators_with_app_name():
    engine = create_engine(env.postgres.uri_core)
    sync_session = sessionmaker(engine, expire_on_commit=False)

    with sync_session() as session:
        try:
            offset = 0
            total_migrated = 0
            skipped_records = 0

            # Count total rows
            total_query = (
                select(func.count())
                .select_from(DeprecatedEvaluatorConfigDB)
                .filter(DeprecatedEvaluatorConfigDB.app_id.isnot(None))
            )
            total_count = session.execute(total_query).scalar() or 0
            click.echo(
                click.style(
                    f"Total rows in evaluator_configs table with app_id: {total_count}",
                    fg="yellow",
                )
            )

            while True:
                records = (
                    session.execute(
                        select(DeprecatedEvaluatorConfigDB)
                        .filter(DeprecatedEvaluatorConfigDB.app_id.isnot(None))
                        .offset(offset)
                        .limit(BATCH_SIZE)
                    )
                    .scalars()
                    .all()
                )
                if not records:
                    break

                # Collect unique app_ids from this batch
                unique_app_ids = list(
                    {record.app_id for record in records if record.app_id is not None}
                )

                # Batch fetch all app names in a single query
                app_names = get_app_names_batch(session, unique_app_ids)

                # Update records with app_name as prefix (using ORM change tracking)
                batch_updated = 0
                batch_skipped = 0
                for record in records:
                    if record.app_id is None:
                        batch_skipped += 1
                        continue

                    app_name = app_names.get(record.app_id)
                    if app_name is not None:
                        record.name = f"{record.name} ({app_name})"
                        batch_updated += 1
                    else:
                        batch_skipped += 1

                session.commit()

                total_migrated += len(records)
                skipped_records += batch_skipped
                offset += BATCH_SIZE
                remaining = total_count - total_migrated

                click.echo(
                    click.style(
                        f"Processed {len(records)} records ({batch_updated} updated, {batch_skipped} skipped). "
                        f"Total: {total_migrated}. Remaining: {remaining}",
                        fg="yellow",
                    )
                )

            # Delete deprecated evaluator configs with app_id as None
            delete_count = (
                session.execute(
                    select(func.count())
                    .select_from(DeprecatedEvaluatorConfigDB)
                    .filter(DeprecatedEvaluatorConfigDB.app_id.is_(None))
                ).scalar()
                or 0
            )
            click.echo(
                click.style(
                    f"Deleting {delete_count} rows with no app_id...",
                    fg="yellow",
                )
            )

            session.execute(
                delete(DeprecatedEvaluatorConfigDB).where(
                    DeprecatedEvaluatorConfigDB.app_id.is_(None)
                )
            )
            session.commit()
            click.echo(
                click.style(
                    "Successfully deleted rows in evaluator_configs with no app_id.",
                    fg="green",
                )
            )

        except Exception as e:
            session.rollback()
            click.echo(
                click.style(
                    f"ERROR updating evaluator config names: {traceback.format_exc()}",
                    fg="red",
                )
            )
            raise e
