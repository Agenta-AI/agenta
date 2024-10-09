import os
import uuid
import traceback
from typing import Optional


import click
from sqlalchemy.future import select
from sqlalchemy import create_engine, delete
from sqlalchemy.orm import sessionmaker, Session

from agenta_backend.models.deprecated_models import (
    DeprecatedEvaluatorConfigDB,
    DeprecatedAppDB,
)


BATCH_SIZE = 1000


def get_app_db(session: Session, app_id: str) -> Optional[DeprecatedAppDB]:
    query = session.execute(select(DeprecatedAppDB).filter_by(id=uuid.UUID(app_id)))
    return query.scalars().first()


def update_evaluators_with_app_name():
    engine = create_engine(os.getenv("POSTGRES_URI"))
    sync_session = sessionmaker(engine, expire_on_commit=False)

    with sync_session() as session:
        try:
            offset = 0
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

                # Update records with app_name as prefix
                for record in records:
                    evaluator_config_app = get_app_db(
                        session=session, app_id=str(record.app_id)
                    )
                    if record.app_id is not None and evaluator_config_app is not None:
                        record.name = f"{record.name} ({evaluator_config_app.app_name})"

                session.commit()
                offset += BATCH_SIZE

            # Delete deprecated evaluator configs with app_id as None
            session.execute(
                delete(DeprecatedEvaluatorConfigDB).where(
                    DeprecatedEvaluatorConfigDB.app_id.is_(None)
                )
            )
            session.commit()
        except Exception as e:
            session.rollback()
            click.echo(
                click.style(
                    f"ERROR updating evaluator config names: {traceback.format_exc()}",
                    fg="red",
                )
            )
            raise e
