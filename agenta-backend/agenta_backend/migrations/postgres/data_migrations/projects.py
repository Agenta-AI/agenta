import os
import traceback


import click
from sqlalchemy.future import select
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from agenta_backend.models.db_models import ProjectDB


def get_default_projects(session):
    query = session.execute(select(ProjectDB).filter_by(is_default=True))
    return query.scalars().all()


def create_default_project():
    PROJECT_NAME = "Default Project"
    engine = create_engine(os.getenv("POSTGRES_URI"))
    sync_session = sessionmaker(engine, expire_on_commit=False)

    with sync_session() as session:
        try:
            default_projects = get_default_projects(session)
            if len(default_projects) > 1:
                raise ValueError(
                    "Multiple default projects found. Please ensure only one exists."
                )

            if len(default_projects) == 0:
                new_project = ProjectDB(project_name=PROJECT_NAME, is_default=True)
                session.add(new_project)
                session.commit()

        except Exception as e:
            session.rollback()
            click.echo(click.style(f"ERROR: {traceback.format_exc()}", fg="red"))
            raise e


def remove_default_project():
    engine = create_engine(os.getenv("POSTGRES_URI"))
    sync_session = sessionmaker(engine, expire_on_commit=False)

    with sync_session() as session:
        try:
            default_projects = get_default_projects(session)
            if len(default_projects) == 0:
                click.echo(
                    click.style("No default project found to remove.", fg="yellow")
                )
                return

            if len(default_projects) > 1:
                raise ValueError(
                    "Multiple default projects found. Please ensure only one exists."
                )

            session.delete(default_projects[0])
            session.commit()
            click.echo(click.style("Default project removed successfully.", fg="green"))

        except Exception as e:
            session.rollback()
            click.echo(click.style(f"ERROR: {traceback.format_exc()}", fg="red"))
            raise e
