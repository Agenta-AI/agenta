import json
import traceback

import click
from sqlalchemy.future import select
from sqlalchemy import Connection, update, func

from oss.src.utils.env import env
from oss.src.dbs.secrets.dbes import SecretsDBE
from oss.src.core.secrets.dtos import (
    StandardProviderDTO,
    StandardProviderSettingsDTO,
)
from oss.src.core.secrets.services import set_data_encryption_key


BATCH_SIZE = 500


def rename_and_update_secrets_data_schema(session: Connection):
    try:
        TOTAL_MIGRATED = 0

        # Count total rows in secrets table
        total_query = select(func.count()).select_from(SecretsDBE)
        result = session.execute(total_query).scalar()
        TOTAL_SECRETS = result or 0
        print(f"Total rows in {SecretsDBE.__tablename__}: {TOTAL_SECRETS}")

        encryption_key = env.AGENTA_CRYPT_KEY
        if not encryption_key:
            raise RuntimeError(
                "Encryption key not found. Stopping migration to rename and update secrets data column."
            )

        last_processed_id = None  # Track last migrated ID

        while True:
            with set_data_encryption_key(data_encryption_key=encryption_key):
                # Fetch a batch of records using keyset pagination (ID-based)
                query = select(SecretsDBE).order_by(SecretsDBE.id).limit(BATCH_SIZE)
                if last_processed_id:
                    query = query.where(SecretsDBE.id > last_processed_id)

                secrets_dbes = session.execute(query).fetchall()
                if not secrets_dbes:
                    break  # No more records to process

                actual_batch_size = len(secrets_dbes)
                if actual_batch_size == 0:
                    break

                # Update the schema structure of data for each record in the batch
                for secret_dbe in secrets_dbes:
                    last_processed_id = secret_dbe.id  # Update checkpoint

                    # Load and validate JSON
                    secret_json_data = json.loads(secret_dbe.data)
                    if (
                        "provider" not in secret_json_data
                        and "key" not in secret_json_data
                    ):
                        raise ValueError(
                            f"Invalid secret data format for ID {secret_dbe.id}. Data format: {secret_json_data}"
                        )

                    secret_data_dto = StandardProviderDTO(
                        kind=secret_json_data["provider"],
                        provider=StandardProviderSettingsDTO(
                            key=secret_json_data["key"],
                        ),
                    )

                    update_statement = (
                        update(SecretsDBE)
                        .where(SecretsDBE.id == secret_dbe.id)
                        .values(data=secret_data_dto.model_dump_json())
                    )
                    session.execute(update_statement)

            TOTAL_MIGRATED += actual_batch_size
            remaining_secrets = TOTAL_SECRETS - TOTAL_MIGRATED

            click.echo(
                click.style(
                    f"Processed {len(secrets_dbes)} records in this batch. "
                    f"Total migrated: {TOTAL_MIGRATED}. Remaining: {remaining_secrets}",
                    fg="yellow",
                )
            )

        click.echo(click.style("All records have been processed.", fg="green"))

    except Exception as e:
        # Handle exceptions and rollback if necessary
        session.rollback()
        click.echo(
            click.style(
                f"\nAn ERROR occurred while renaming and updating secrets data schema: {traceback.format_exc()}",
                fg="red",
            ),
            color=True,
        )
        raise e


def revert_rename_and_update_secrets_data_schema(session: Connection):
    try:
        TOTAL_MIGRATED = 0

        # Count total rows in secrets table
        total_query = select(func.count()).select_from(SecretsDBE)
        TOTAL_SECRETS = session.execute(total_query).scalar() or 0
        print(f"Total rows in {SecretsDBE.__tablename__}: {TOTAL_SECRETS}")

        encryption_key = env.AGENTA_CRYPT_KEY
        if not encryption_key:
            raise RuntimeError(
                "Encryption key not found. Stopping migration to revert rename and update secrets data column."
            )

        last_processed_id = None  # Track last reverted ID

        while True:
            with set_data_encryption_key(data_encryption_key=encryption_key):
                # Fetch a batch of records using keyset pagination
                query = select(SecretsDBE).order_by(SecretsDBE.id).limit(BATCH_SIZE)
                if last_processed_id:
                    query = query.where(SecretsDBE.id > last_processed_id)

                secrets_dbes = session.execute(query).fetchall()
                if not secrets_dbes:
                    break  # No more records to process

                for secret_dbe in secrets_dbes:
                    last_processed_id = secret_dbe.id  # Update checkpoint

                    # Load and validate JSON
                    secret_json_data = json.loads(secret_dbe.data)
                    if (
                        "kind" not in secret_json_data
                        and "provider" not in secret_json_data
                    ):
                        raise ValueError(
                            f"Invalid secret format for ID {secret_dbe.id}"
                        )

                    # Convert back to old schema
                    old_format_data = {
                        "provider": secret_json_data["kind"],
                        "key": secret_json_data["provider"]["key"],
                    }

                    # Update record with encryption
                    session.execute(
                        update(SecretsDBE)
                        .where(SecretsDBE.id == secret_dbe.id)
                        .values(data=json.dumps(old_format_data))
                    )

            TOTAL_MIGRATED += len(secrets_dbes)
            remaining_secrets = TOTAL_SECRETS - TOTAL_MIGRATED

            click.echo(
                click.style(
                    f"Processed {len(secrets_dbes)} records in this batch. "
                    f"Total reverted: {TOTAL_MIGRATED}. Remaining: {remaining_secrets}",
                    fg="yellow",
                )
            )

        click.echo(click.style("All records have been reverted.", fg="green"))

    except Exception as e:
        session.rollback()  # Ensure rollback on failure
        click.echo(
            click.style(
                f"\nAn ERROR occurred while reverting secrets data schema: {traceback.format_exc()}",
                fg="red",
            ),
            color=True,
        )
        raise e
