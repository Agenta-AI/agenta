import os
import traceback
from typing import Sequence


import click
from sqlalchemy.future import select
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker, Session

from agenta_backend.models.db_models import (
    ProjectDB,
    AppDB,
    AppVariantDB,
    AppVariantRevisionsDB,
    VariantBaseDB,
    DeploymentDB,
    ImageDB,
    AppEnvironmentDB,
    AppEnvironmentRevisionDB,
    EvaluationScenarioDB,
    EvaluationDB,
    EvaluatorConfigDB,
    HumanEvaluationDB,
    HumanEvaluationScenarioDB,
    TestSetDB,
)


BATCH_SIZE = 1000
MODELS = [
    AppDB,
    AppVariantDB,
    AppVariantRevisionsDB,
    VariantBaseDB,
    DeploymentDB,
    ImageDB,
    AppEnvironmentDB,
    AppEnvironmentRevisionDB,
    EvaluationScenarioDB,
    EvaluationDB,
    EvaluatorConfigDB,
    HumanEvaluationDB,
    HumanEvaluationScenarioDB,
    TestSetDB,
]


def get_default_projects(session):
    query = session.execute(select(ProjectDB).filter_by(is_default=True))
    return query.scalars().all()


def check_for_multiple_default_projects(session: Session) -> Sequence[ProjectDB]:
    default_projects = get_default_projects(session)
    if len(default_projects) > 1:
        raise ValueError(
            "Multiple default projects found. Please ensure only one exists."
        )
    return default_projects


def create_default_project():
    PROJECT_NAME = "Default Project"
    engine = create_engine(os.getenv("POSTGRES_URI"))
    sync_session = sessionmaker(engine, expire_on_commit=False)

    with sync_session() as session:
        try:
            default_projects = check_for_multiple_default_projects(session)
            if len(default_projects) == 0:
                new_project = ProjectDB(project_name=PROJECT_NAME, is_default=True)
                session.add(new_project)
                session.commit()

        except Exception as e:
            session.rollback()
            click.echo(
                click.style(
                    f"ERROR creating default project: {traceback.format_exc()}",
                    fg="red",
                )
            )
            raise e


def remove_default_project():
    engine = create_engine(os.getenv("POSTGRES_URI"))
    sync_session = sessionmaker(engine, expire_on_commit=False)

    with sync_session() as session:
        try:
            default_projects = check_for_multiple_default_projects(session)
            if len(default_projects) == 0:
                click.echo(
                    click.style("No default project found to remove.", fg="yellow")
                )
                return

            session.delete(default_projects[0])
            session.commit()
            click.echo(click.style("Default project removed successfully.", fg="green"))

        except Exception as e:
            session.rollback()
            click.echo(click.style(f"ERROR: {traceback.format_exc()}", fg="red"))
            raise e


def add_project_id_to_db_entities():
    engine = create_engine(os.getenv("POSTGRES_URI"))
    sync_session = sessionmaker(engine, expire_on_commit=False)

    with sync_session() as session:
        try:
            default_project = check_for_multiple_default_projects(session)[0]
            for model in MODELS:
                offset = 0
                while True:
                    records = (
                        session.execute(
                            select(model)
                            .where(model.project_id == None)
                            .offset(offset)
                            .limit(BATCH_SIZE)
                        )
                        .scalars()
                        .all()
                    )
                    if not records:
                        break

                    # Update records with default project_id
                    for record in records:
                        record.project_id = default_project.id

                    session.commit()
                    offset += BATCH_SIZE

        except Exception as e:
            session.rollback()
            click.echo(
                click.style(
                    f"ERROR adding project_id to db entities: {traceback.format_exc()}",
                    fg="red",
                )
            )
            raise e


def remove_project_id_from_db_entities():
    engine = create_engine(os.getenv("POSTGRES_URI"))
    sync_session = sessionmaker(engine, expire_on_commit=False)

    with sync_session() as session:
        try:
            for model in MODELS:
                offset = 0
                while True:
                    records = (
                        session.execute(
                            select(model)
                            .where(model.project_id != None)
                            .offset(offset)
                            .limit(BATCH_SIZE)
                        )
                        .scalars()
                        .all()
                    )
                    if not records:
                        break

                    # Update records project_id column with None
                    for record in records:
                        record.project_id = None

                    session.commit()
                    offset += BATCH_SIZE

        except Exception as e:
            session.rollback()
            click.echo(
                click.style(
                    f"ERROR removing project_id to db entities: {traceback.format_exc()}",
                    fg="red",
                )
            )
            raise e
