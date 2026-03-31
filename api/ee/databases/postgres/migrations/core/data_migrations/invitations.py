import uuid
import traceback

import click
from sqlalchemy.future import select
from sqlalchemy.orm import joinedload
from sqlalchemy import delete, Connection, insert, func

from oss.src.models.db_models import UserDB, InvitationDB, ProjectDB
from ee.src.models.extended.deprecated_models import OldInvitationDB


BATCH_SIZE = 200


def transfer_invitations_from_old_table_to_new_table(session: Connection):
    try:
        offset = 0
        TOTAL_MIGRATED = 0
        SKIPPED_INVITATIONS = 0

        # Count total rows in OldInvitationDB table
        count_query = select(func.count()).select_from(OldInvitationDB)
        result = session.execute(count_query).scalar()
        TOTAL_INVITATIONS = result if result is not None else 0
        print(f"Total rows in OldInvitationDB table is {TOTAL_INVITATIONS}")

        while True:
            # Retrieve a batch of old invitations
            query = session.execute(
                select(OldInvitationDB).offset(offset).limit(BATCH_SIZE)
            )
            old_invitations = query.fetchall()
            actual_batch_size = len(old_invitations)
            if not old_invitations:
                break

            for old_invitation in old_invitations:
                user = session.execute(
                    select(UserDB).where(UserDB.email == old_invitation.email)
                ).fetchone()

                project = session.execute(
                    select(ProjectDB).where(
                        ProjectDB.workspace_id == uuid.UUID(old_invitation.workspace_id)
                    )
                ).fetchone()
                if user and project:
                    print(
                        f"Found user {user.username} in workspace invitation ({str(old_invitation.id)})"
                    )
                    print(
                        f"Found project {str(project.id)} that will be used to transfer workspace invitation into."
                    )
                    # Map fields from OldInvitationDB to InvitationDB
                    statement = insert(InvitationDB).values(
                        id=old_invitation.id,
                        token=old_invitation.token,
                        email=old_invitation.email,
                        used=old_invitation.used,
                        role=old_invitation.workspace_roles[0],
                        user_id=user.id,
                        project_id=project.id,
                        expiration_date=old_invitation.expiration_date,
                    )

                    # Add the new invitation to the session
                    session.execute(statement)

                    # Remove old invitation
                    session.execute(
                        delete(OldInvitationDB).where(
                            OldInvitationDB.id == old_invitation.id
                        )
                    )
                else:
                    print(
                        f"Skipping unused workspace invitation {str(old_invitation.id)}. No matching user or project."
                    )
                    SKIPPED_INVITATIONS += 1

            # Commit the changes for the current batch
            session.commit()

            # Update migration progress
            TOTAL_MIGRATED += actual_batch_size
            offset += actual_batch_size
            remaining_records = TOTAL_INVITATIONS - TOTAL_MIGRATED
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
                f"\nSuccessfully transferred workspaces invitations to projects invitations table. Skipped {SKIPPED_INVITATIONS} records.",
                fg="green",
            ),
            color=True,
        )

    except Exception as e:
        session.rollback()
        click.echo(
            click.style(
                f"\nAn ERROR occurred while transferring workspaces invitations: {traceback.format_exc()}",
                fg="red",
            ),
            color=True,
        )
        raise e


def revert_invitations_transfer_from_new_table_to_old_table(session: Connection):
    try:
        offset = 0
        TOTAL_MIGRATED = 0

        # Count total rows in invitations table
        stmt = select(func.count()).select_from(InvitationDB)
        result = session.execute(stmt).scalar()
        TOTAL_INVITATIONS = result if result is not None else 0
        print(f"Total rows in project_invitations table is {TOTAL_INVITATIONS}")

        while True:
            # Retrieve a batch of project invitations
            project_invitations = session.execute(
                select(InvitationDB)
                .offset(offset)
                .limit(BATCH_SIZE)
                .options(joinedload(InvitationDB.project))
            ).fetchall()
            if not project_invitations:
                break

            for project_invitation in project_invitations:
                # Map fields from InvitationDB to OldInvitationDB
                statement = insert(OldInvitationDB).values(
                    id=project_invitation.id,
                    token=project_invitation.token,
                    email=project_invitation.email,
                    used=project_invitation.used,
                    organization_id=str(project_invitation.project.workspace_id),
                    workspace_id=str(project_invitation.project.workspace_id),
                    workspace_roles=[project_invitation.role],
                    expiration_date=project_invitation.expiration_date,
                )
                session.execute(statement)

                # Remove previous invitation (that references project_id)
                session.execute(
                    delete(InvitationDB).where(InvitationDB.id == project_invitation.id)
                )

            # Commit the changes for the current batch
            session.commit()

            # Update migration progress
            TOTAL_MIGRATED += BATCH_SIZE
            offset += BATCH_SIZE
            click.echo(
                click.style(
                    f"Processed {offset} records in this batch. Total records migrated: {TOTAL_MIGRATED}. Records left to migrate: {TOTAL_INVITATIONS - TOTAL_MIGRATED}",
                    fg="yellow",
                )
            )

        click.echo(
            click.style(
                "\nSuccessfully transferred projects invitations to the workspaces invitations table.",
                fg="green",
            ),
            color=True,
        )

    except Exception as e:
        session.rollback()
        click.echo(
            click.style(
                f"\nAn ERROR occurred while transferring projects invitations: {traceback.format_exc()}",
                fg="red",
            ),
            color=True,
        )
        raise e
