import traceback
import click
from sqlalchemy.future import select
from sqlalchemy import Connection, insert, func
from ee.src.models.db_models import OrganizationMemberDB  # type: ignore
from ee.src.models.extended.deprecated_models import UserOrganizationDB  # type: ignore

BATCH_SIZE = 200


def transfer_records_from_user_organization_to_organization_members(
    session: Connection,
):
    try:
        offset = 0
        TOTAL_MIGRATED = 0

        # Count total rows in user_organizations table
        total_query = select(func.count()).select_from(UserOrganizationDB)
        result = session.execute(total_query).scalar()
        TOTAL_USERS_ORGANIZATIONS = result if result is not None else 0
        print(f"Total rows in UserOrganizationDB table: {TOTAL_USERS_ORGANIZATIONS}")

        while True:
            # Fetch a batch of records from user_organizations with ordering
            users_in_organizations = session.execute(
                select(UserOrganizationDB).offset(offset).limit(BATCH_SIZE)
            ).fetchall()

            actual_batch_size = len(users_in_organizations)
            if actual_batch_size == 0:
                break

            for user_organization in users_in_organizations:
                # Check if the record already exists in OrganizationMemberDB
                existing_record = session.execute(
                    select(OrganizationMemberDB).where(
                        OrganizationMemberDB.user_id == user_organization.user_id,
                        OrganizationMemberDB.organization_id
                        == user_organization.organization_id,
                    )
                ).fetchone()
                if existing_record:
                    # Log that a duplicate was found
                    click.echo(
                        click.style(
                            f"Duplicate record found for user_id {user_organization.user_id} and organization_id {user_organization.organization_id}. Skipping.",
                            fg="yellow",
                        )
                    )
                    continue  # Skip inserting this record

                # Insert a new record in OrganizationMemberDB
                insert_statement = insert(OrganizationMemberDB).values(
                    user_id=user_organization.user_id,
                    organization_id=user_organization.organization_id,
                )
                session.execute(insert_statement)

            # Commit the batch
            session.commit()

            # Update migration progress
            TOTAL_MIGRATED += actual_batch_size
            offset += actual_batch_size
            remaining_records = TOTAL_USERS_ORGANIZATIONS - TOTAL_MIGRATED

            click.echo(
                click.style(
                    f"Processed {actual_batch_size} records in this batch. Total records migrated: {TOTAL_MIGRATED}. Records left to migrate: {remaining_records}",
                    fg="yellow",
                )
            )

        # Check if there are still remaining records
        remaining_records_query = select(func.count()).select_from(UserOrganizationDB)
        remaining_count = session.execute(remaining_records_query).scalar()
        records_left_count = remaining_count if remaining_count is not None else 0
        if records_left_count > 0:
            click.echo(
                click.style(
                    f"There are still {remaining_count} records left in UserOrganizationDB that were not migrated.",
                    fg="red",
                )
            )

        click.echo(
            click.style(
                "\nSuccessfully migrated records and handled duplicates in user_organization table to organization_members.",
                fg="green",
            ),
            color=True,
        )
    except Exception as e:
        # Handle exceptions and rollback if necessary
        session.rollback()
        click.echo(
            click.style(
                f"\nAn ERROR occurred while transferring records: {traceback.format_exc()}",
                fg="red",
            ),
            color=True,
        )
        raise e


def transfer_records_from_organization_members_to_user_organization(
    session: Connection,
):
    try:
        offset = 0
        TOTAL_MIGRATED = 0

        # Count total rows in OrganizationMemberDB
        total_query = select(func.count()).select_from(OrganizationMemberDB)
        result = session.execute(total_query).scalar()
        TOTAL_ORGANIZATIONS_MEMBERS = result if result is not None else 0
        print(
            f"Total rows in OrganizationMemberDB table: {TOTAL_ORGANIZATIONS_MEMBERS}"
        )

        while True:
            # Retrieve a batch of records from OrganizationMemberDB
            members_in_organizations = session.execute(
                select(OrganizationMemberDB).offset(offset).limit(BATCH_SIZE)
            ).fetchall()
            actual_batch_size = len(members_in_organizations)
            if not members_in_organizations:
                break

            # Process each record in the current batch
            for user_organization in members_in_organizations:
                # Create a new record in UserOrganizationDB
                insert_statement = insert(UserOrganizationDB).values(
                    user_id=user_organization.user_id,
                    organization_id=user_organization.organization_id,
                )
                session.execute(insert_statement)

            # Commit the batch
            session.commit()

            # Update migration progress
            TOTAL_MIGRATED += actual_batch_size
            offset += actual_batch_size
            remaining_records = TOTAL_ORGANIZATIONS_MEMBERS - TOTAL_MIGRATED
            click.echo(
                click.style(
                    f"Processed {actual_batch_size} records in this batch. Total records migrated: {TOTAL_MIGRATED}. Records left to migrate: {remaining_records}",
                    fg="yellow",
                )
            )

            # Break the loop if all records are migrated
            if remaining_records <= 0:
                break

        click.echo(
            click.style(
                "\nSuccessfully migrated records in organization_members table to user_organizations table.",
                fg="green",
            ),
            color=True,
        )
    except Exception as e:
        # Handle exceptions and rollback if necessary
        session.rollback()
        click.echo(
            click.style(
                f"\nAn ERROR occurred while transferring records from organization_members to user_organizations: {traceback.format_exc()}",
                fg="red",
            ),
            color=True,
        )
        raise e
