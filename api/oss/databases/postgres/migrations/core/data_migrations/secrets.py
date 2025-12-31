import json
import traceback

import click
from sqlalchemy import Connection, MetaData, Table, func, select, update

from oss.src.utils.env import env
from oss.src.core.secrets.dtos import (
    StandardProviderDTO,
    StandardProviderSettingsDTO,
)
from oss.src.core.secrets.services import set_data_encryption_key


BATCH_SIZE = 500


def _secrets_table(session: Connection) -> Table:
    metadata = MetaData()
    return Table("secrets", metadata, autoload_with=session)


def rename_and_update_secrets_data_schema(session: Connection):
    try:
        TOTAL_MIGRATED = 0

        secrets_table = _secrets_table(session)

        # Count total rows in secrets table
        total_query = select(func.count()).select_from(secrets_table)
        result = session.execute(total_query).scalar()
        TOTAL_SECRETS = result or 0
        print(f"Total rows in secrets: {TOTAL_SECRETS}")

        encryption_key = env.agenta.crypt_key
        if not encryption_key:
            raise RuntimeError(
                "Encryption key not found. Stopping migration to rename and update secrets data column."
            )

        last_processed_id = None  # Track last migrated ID

        while True:
            with set_data_encryption_key(data_encryption_key=encryption_key):
                data_expr = func.pgp_sym_decrypt(
                    secrets_table.c.data, encryption_key
                ).label("data")
                stmt = (
                    select(secrets_table.c.id, data_expr)
                    .order_by(secrets_table.c.id)
                    .limit(BATCH_SIZE)
                )
                if last_processed_id:
                    stmt = stmt.where(secrets_table.c.id > last_processed_id)

                secrets_rows = session.execute(stmt).fetchall()
                if not secrets_rows:
                    break

                actual_batch_size = len(secrets_rows)
                if actual_batch_size == 0:
                    break

                for secret_row in secrets_rows:
                    secret_id = secret_row.id
                    last_processed_id = secret_id

                    secret_json_data = json.loads(secret_row.data)
                    if (
                        "provider" not in secret_json_data
                        and "key" not in secret_json_data
                    ):
                        raise ValueError(
                            f"Invalid secret data format for ID {secret_id}. Data format: {secret_json_data}"
                        )

                    secret_data_dto = StandardProviderDTO(
                        kind=secret_json_data["provider"],
                        provider=StandardProviderSettingsDTO(
                            key=secret_json_data["key"],
                        ),
                    )

                    update_statement = (
                        update(secrets_table)
                        .where(secrets_table.c.id == secret_id)
                        .values(
                            data=func.pgp_sym_encrypt(
                                secret_data_dto.model_dump_json(),
                                encryption_key,
                            )
                        )
                    )
                    session.execute(update_statement)

            TOTAL_MIGRATED += actual_batch_size
            remaining_secrets = TOTAL_SECRETS - TOTAL_MIGRATED

            click.echo(
                click.style(
                    f"Processed {len(secrets_rows)} records in this batch. "
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

        secrets_table = _secrets_table(session)

        # Count total rows in secrets table
        total_query = select(func.count()).select_from(secrets_table)
        TOTAL_SECRETS = session.execute(total_query).scalar() or 0
        print(f"Total rows in secrets: {TOTAL_SECRETS}")

        encryption_key = env.agenta.crypt_key
        if not encryption_key:
            raise RuntimeError(
                "Encryption key not found. Stopping migration to revert rename and update secrets data column."
            )

        last_processed_id = None  # Track last reverted ID

        while True:
            with set_data_encryption_key(data_encryption_key=encryption_key):
                data_expr = func.pgp_sym_decrypt(
                    secrets_table.c.data, encryption_key
                ).label("data")
                stmt = (
                    select(secrets_table.c.id, data_expr)
                    .order_by(secrets_table.c.id)
                    .limit(BATCH_SIZE)
                )
                if last_processed_id:
                    stmt = stmt.where(secrets_table.c.id > last_processed_id)

                secrets_rows = session.execute(stmt).fetchall()
                if not secrets_rows:
                    break

                for secret_row in secrets_rows:
                    secret_id = secret_row.id
                    last_processed_id = secret_id

                    secret_json_data = json.loads(secret_row.data)
                    if (
                        "kind" not in secret_json_data
                        and "provider" not in secret_json_data
                    ):
                        raise ValueError(
                            f"Invalid secret format for ID {secret_id}"
                        )

                    old_format_data = {
                        "provider": secret_json_data["kind"],
                        "key": secret_json_data["provider"]["key"],
                    }

                    session.execute(
                        update(secrets_table)
                        .where(secrets_table.c.id == secret_id)
                        .values(
                            data=func.pgp_sym_encrypt(
                                json.dumps(old_format_data), encryption_key
                            )
                        )
                    )

            TOTAL_MIGRATED += len(secrets_rows)
            remaining_secrets = TOTAL_SECRETS - TOTAL_MIGRATED

            click.echo(
                click.style(
                    f"Processed {len(secrets_rows)} records in this batch. "
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
