import traceback

import click
from sqlalchemy.future import select
from sqlalchemy import delete, Connection, insert, func

from oss.src.models.db_models import (
    WorkspaceDB,
    ProjectDB,
)
from ee.src.models.db_models import (
    WorkspaceMemberDB,
    ProjectMemberDB,
)

BATCH_SIZE = 200


def get_or_create_workspace_default_project(
    session: Connection, workspace: WorkspaceDB
) -> None:
    project = session.execute(
        select(ProjectDB).filter_by(
            is_default=True,
            workspace_id=workspace.id,
        )
    ).fetchone()

    if project is None:
        statement = insert(ProjectDB).values(
            project_name="Default",
            is_default=True,
            workspace_id=workspace.id,
            organization_id=workspace.organization_id,
        )
        session.execute(statement)


def create_default_project_for_workspaces(session: Connection):
    try:
        offset = 0
        TOTAL_MIGRATED = 0

        # Count total rows in workspaces table
        stmt = select(func.count()).select_from(WorkspaceDB)
        result = session.execute(stmt).scalar()
        TOTAL_WORKSPACES = result if result is not None else 0
        print(f"Total rows in workspaces table is {TOTAL_WORKSPACES}")

        while True:
            # Retrieve a batch of workspaces without a project
            workspaces = session.execute(
                select(WorkspaceDB).offset(offset).limit(BATCH_SIZE)
            ).fetchall()
            actual_batch_size = len(workspaces)
            if not workspaces:
                break

            for workspace in workspaces:
                # Create a new default project for each workspace
                get_or_create_workspace_default_project(
                    session=session,
                    workspace=workspace,  # type: ignore
                )

            # Commit the changes for the current batch
            session.commit()

            # Update migration progress
            TOTAL_MIGRATED += actual_batch_size
            offset += actual_batch_size
            remaining_records = TOTAL_WORKSPACES - TOTAL_MIGRATED
            click.echo(
                click.style(
                    f"Processed {offset} records in this batch. Total records migrated: {TOTAL_MIGRATED}. Records left to migrate: {remaining_records} ",
                    fg="yellow",
                )
            )

            # Stop the loop when all records have been processed
            if remaining_records <= 0:
                break

        click.echo(
            click.style(
                "\nSuccessfully created default projects for workspaces.",
                fg="green",
            ),
            color=True,
        )

    except Exception as e:
        session.rollback()
        click.echo(
            click.style(
                f"\nAn ERROR occurred while creating default projects: {traceback.format_exc()}",
                fg="red",
            ),
            color=True,
        )
        raise e


def create_default_project_memberships(session: Connection):
    try:
        offset = 0
        TOTAL_MIGRATED = 0
        SKIPPED_RECORDS = 0

        # Count total rows in workspaces_members table
        stmt = select(func.count()).select_from(WorkspaceMemberDB)
        result = session.execute(stmt).scalar()
        TOTAL_WORKSPACES_MEMBERS = result if result is not None else 0
        print(f"Total rows in workspaces_members table is {TOTAL_WORKSPACES_MEMBERS}")

        while True:
            # Retrieve a batch of workspace members
            workspace_members = session.execute(
                select(WorkspaceMemberDB).offset(offset).limit(BATCH_SIZE)
            ).fetchall()
            actual_batch_size = len(workspace_members)
            if not workspace_members:
                break

            for workspace_member in workspace_members:
                # Find the default project for the member's workspace
                project_query = session.execute(
                    select(ProjectDB)
                    .where(
                        ProjectDB.workspace_id == workspace_member.workspace_id,
                        ProjectDB.is_default == True,  # noqa: E712
                    )
                    .limit(1)
                )
                default_project = project_query.fetchone()
                if default_project:
                    # Create a new project membership for each workspace member
                    statement = insert(ProjectMemberDB).values(
                        user_id=workspace_member.user_id,
                        project_id=getattr(default_project, "id"),
                        role=workspace_member.role,
                    )
                    session.execute(statement)
                else:
                    print(
                        f"Skipping record... Did not find any default project for workspace {str(workspace_member.workspace_id)}"
                    )
                    SKIPPED_RECORDS += 1

            # Commit the changes for the current batch
            session.commit()

            # Update migration progress
            TOTAL_MIGRATED += actual_batch_size
            offset += actual_batch_size
            remaining_records = TOTAL_WORKSPACES_MEMBERS - TOTAL_MIGRATED
            click.echo(
                click.style(
                    f"Processed {offset} records in this batch. Total records migrated: {TOTAL_MIGRATED}. Records left to migrate: {remaining_records} ",
                    fg="yellow",
                )
            )

            # Stop the loop when all records have been processed
            if remaining_records <= 0:
                break

        click.echo(
            click.style(
                f"\nSuccessfully created default project memberships for workspace members. Skipped {SKIPPED_RECORDS} records.",
                fg="green",
            ),
            color=True,
        )

    except Exception as e:
        session.rollback()
        click.echo(
            click.style(
                f"\nAn ERROR occurred while creating project memberships: {traceback.format_exc()}",
                fg="red",
            ),
            color=True,
        )
        raise e


def remove_default_projects_from_workspaces(session: Connection):
    try:
        offset = 0
        TOTAL_MIGRATED = 0

        # Count total rows in projects table
        stmt = (
            select(func.count())
            .select_from(ProjectDB)
            .where(ProjectDB.is_default == True)  # noqa: E712
        )
        result = session.execute(stmt).scalar()
        TOTAL_PROJECTS = result if result is not None else 0
        print(f"Total rows in projects table is {TOTAL_PROJECTS}")

        while True:
            # Retrieve a batch of workspaces with a default project
            projects_to_delete = session.execute(
                select(ProjectDB)
                .where(ProjectDB.is_default == True)  # noqa: E712
                .offset(offset)
                .limit(BATCH_SIZE)  # type: ignore
            ).fetchall()
            actual_batch_size = len(projects_to_delete)
            if not projects_to_delete:
                break

            for project in projects_to_delete:
                if project is not None and len(project) >= 1:
                    # Remove associated project memberships
                    session.execute(
                        delete(ProjectMemberDB).where(
                            ProjectMemberDB.project_id == project.id
                        )
                    )

                    # Remove the default project itself
                    session.execute(delete(ProjectDB).where(ProjectDB.id == project.id))

            # Update migration progress
            TOTAL_MIGRATED += actual_batch_size
            offset += actual_batch_size
            remaining_records = TOTAL_PROJECTS - TOTAL_MIGRATED
            click.echo(
                click.style(
                    f"Processed {offset} records in this batch. Total records migrated: {TOTAL_MIGRATED}. Records left to migrate: {remaining_records} ",
                    fg="yellow",
                )
            )

            # Stop the loop when all records have been processed
            if remaining_records <= 0:
                break

        click.echo(
            click.style(
                "\nSuccessfully removed default projects and associated memberships from existing workspaces.",
                fg="green",
            ),
            color=True,
        )
    except Exception as e:
        # Handle exceptions and rollback if necessary
        session.rollback()
        click.echo(
            click.style(
                f"\nAn ERROR occurred while removing default projects and memberships: {traceback.format_exc()}",
                fg="red",
            ),
            color=True,
        )
        raise e
