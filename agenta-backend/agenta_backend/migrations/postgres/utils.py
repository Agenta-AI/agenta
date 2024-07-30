import os
import logging

import click
import asyncpg
from sqlalchemy.exc import ProgrammingError

from alembic.config import Config
from sqlalchemy import inspect, text
from alembic.script import ScriptDirectory
from sqlalchemy.ext.asyncio import create_async_engine, AsyncEngine

from agenta_backend.utils.common import isCloudEE


# Initializer logger
logger = logging.getLogger("alembic.env")

# Initialize alembic config
try:
    alembic_cfg = Config(os.environ["ALEMBIC_CFG_PATH"])
except KeyError:
    raise KeyError(
        "Could not find ALEMBIC_CFG_PATH. Ensure that it is in the backend environment variables."
    )

script = ScriptDirectory.from_config(alembic_cfg)


def is_initial_setup(engine) -> bool:
    """
    Check if the database is in its initial state by verifying the existence of required tables.

    This function inspects the current state of the database and determines if it needs initial setup by checking for the presence of a predefined set of required tables.

    Args:
        engine (sqlalchemy.engine.base.Engine): The SQLAlchemy engine used to connect to the database.

    Returns:
        bool: True if the database is in its initial state (i.e., not all required tables exist), False otherwise.
    """

    inspector = inspect(engine)
    required_tables = [
        "users",
        "app_db",
        "deployments",
        "bases",
        "app_variants",
        "ids_mapping",
    ]  # NOTE: The tables here were picked at random. Having all the tables in the database in the list \
    # will not change the behaviour of this function, so best to leave things as it is!
    existing_tables = inspector.get_table_names()

    # Check if all required tables exist in the database
    all_tables_exist = all(table in existing_tables for table in required_tables)

    # Log the status of the tables
    logger.info(f"Required tables: {required_tables}")
    logger.info(f"Existing tables: {existing_tables}")
    logger.info(f"All tables exist: {all_tables_exist}")

    return not all_tables_exist


async def get_applied_migrations(engine: AsyncEngine):
    """
    Checks the alembic_version table to get all the migrations that has been applied.

    Args:
        engine (Engine): The engine that connects to an sqlalchemy pool

    Returns:
        a list of strings
    """

    async with engine.connect() as connection:
        try:
            result = await connection.execute(text("SELECT version_num FROM alembic_version"))  # type: ignore
        except (asyncpg.exceptions.UndefinedTableError, ProgrammingError):
            # Note: If the alembic_version table does not exist, it will result in raising an UndefinedTableError exception.
            # We need to suppress the error and return a list with the alembic_version table name to inform the user that there is a pending migration \
            # to make Alembic start tracking the migration changes.
            # --------------------------------------------------------------------------------------
            # This effect (the exception raising) happens for both users (first-time and returning)
            return ["alembic_version"]

        applied_migrations = [row[0] for row in result.fetchall()]
        return applied_migrations


async def get_pending_migrations():
    """
    Gets the migrations that have not been applied.

    Returns:
        the number of pending migrations
    """

    engine = create_async_engine(url=os.environ["POSTGRES_URI"])
    try:
        applied_migrations = await get_applied_migrations(engine=engine)
        migration_files = [script.revision for script in script.walk_revisions()]
        pending_migrations = [m for m in migration_files if m not in applied_migrations]

        if "alembic_version" in applied_migrations:
            pending_migrations.append("alembic_version")
    finally:
        await engine.dispose()

    return pending_migrations


async def check_for_new_migrations():
    """
    Checks for new migrations and notify the user.
    """

    pending_migrations = await get_pending_migrations()
    if len(pending_migrations) >= 1:
        click.echo(
            click.style(
                f"\nWe have detected that there are pending database migrations {pending_migrations} that need to be applied to keep your system up to date. \nTo ensure your application functions correctly with the latest updates, please follow the guide here => https://docs.agenta.ai/self-host/migration/applying-schema-migration\n",
                fg="yellow",
            ),
            color=True,
        )
    return


async def check_if_templates_table_exist():
    """
    Checks if the templates table exists in the database.
    """

    engine = create_async_engine(url=os.environ["POSTGRES_URI"])
    async with engine.connect() as connection:
        try:
            await connection.execute(text("SELECT id FROM templates"))  # type: ignore
        except (asyncpg.exceptions.UndefinedTableError, ProgrammingError):
            return False
        finally:
            await engine.dispose()

        return True
