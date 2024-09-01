import os
import traceback

import click
from slugify import slugify

from sqlalchemy.future import select
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.exc import MultipleResultsFound

from agenta_backend.models.db_models import AppDB, ProjectDB


def assign_default_project():
    # Define the project name that was used as default
    PROJECT_NAME = "Default Project"

    # Create engine for db connection
    engine = create_engine(url=os.environ["POSTGRES_URI"])

    # Create a session factory
    sync_session = sessionmaker(engine, expire_on_commit=False)

    with sync_session() as session:
        try:
            # Retrieve the default project
            query = session.execute(
                select(ProjectDB).filter_by(slug_name=slugify(PROJECT_NAME))
            )
            default_projects = query.scalars().all()

            # Ensure that multiple projects do not exist, otherwise raise an exception
            if len(default_projects) > 1:
                ERROR_MESSAGE = (
                    f"Error: Multiple default projects found. Only one default project is allowed. "
                    f"Please ensure there is only one project with the slug name '{slugify(PROJECT_NAME)}' and try again."
                )
                click.echo(click.style(ERROR_MESSAGE, fg="red"), color=True)
                raise MultipleResultsFound(ERROR_MESSAGE)

            # If no default project exists, create one
            if not default_projects:
                new_project = ProjectDB(
                    project_name=PROJECT_NAME, slug_name=slugify(PROJECT_NAME)
                )
                session.add(new_project)
                session.commit()
                default_project = new_project
            else:
                default_project = default_projects[0]

            # Fetch all apps with project_id as None
            apps_query = session.execute(
                select(AppDB).filter(AppDB.project_id.is_(None))
            )
            apps = apps_query.scalars().all()

            # Update each app individually
            for app in apps:
                app.project_id = default_project.id
            session.commit()

        except Exception as e:
            # Handle exceptions and rollback if necessary
            session.rollback()
            click.echo(
                click.style(
                    f"\nAn ERROR occurred while assigning the default project to existing apps: {traceback.format_exc()}",
                    fg="red",
                ),
                color=True,
            )
            raise e


def revert_default_project():
    # Define the project name that was used as default
    PROJECT_NAME = "Default Project"

    # Create engine for db connection
    engine = create_engine(url=os.environ["POSTGRES_URI"])

    # Create a session factory
    sync_session = sessionmaker(engine, expire_on_commit=False)

    with sync_session() as session:
        try:
            # Retrieve the default project
            query = session.execute(
                select(ProjectDB).filter_by(slug_name=slugify(PROJECT_NAME))
            )
            default_projects = query.scalars().all()

            # If no default project is found, nothing to revert
            if not default_projects:
                click.echo(
                    click.style("No default project found to revert.", fg="yellow"),
                    color=True,
                )
                return

            # Ensure that only one default project exists
            if len(default_projects) > 1:
                ERROR_MESSAGE = (
                    f"Error: Multiple default projects found. Only one default project is allowed. "
                    f"Please ensure there is only one project with the slug name '{slugify(PROJECT_NAME)}' and try again."
                )
                click.echo(click.style(ERROR_MESSAGE, fg="red"), color=True)
                raise MultipleResultsFound(ERROR_MESSAGE)

            # Get the default project
            default_project = default_projects[0]

            # Set all apps' project_id to None
            apps_query = session.execute(
                select(AppDB).filter(AppDB.project_id.is_(None))
            )
            apps = apps_query.scalars().all()

            # Update each app individually
            for app in apps:
                app.project_id = None

            # Delete the default project
            session.delete(default_project)
            session.commit()

            click.echo(
                click.style("Reverted changes successfully.", fg="green"), color=True
            )

        except Exception as e:
            # Handle exceptions and rollback if necessary
            session.rollback()
            click.echo(
                click.style(
                    f"\nAn ERROR occurred while reverting the default project changes: {traceback.format_exc()}",
                    fg="red",
                ),
                color=True,
            )
            raise e
