import asyncio
import logging
import traceback

import click
import asyncpg
from alembic import command
from sqlalchemy import Engine
from alembic.config import Config
from sqlalchemy import inspect, text
from alembic.script import ScriptDirectory
from sqlalchemy.exc import ProgrammingError
from sqlalchemy.ext.asyncio import create_async_engine, AsyncEngine

from oss.src.utils.env import env


# Initializer logger
logger = logging.getLogger("alembic.env")

# Initialize alembic config
alembic_cfg = Config(env.alembic.cfg_path_tracing)
script = ScriptDirectory.from_config(alembic_cfg)

logger.info("license: ee")
logger.info("migrations: tracing")
logger.info("ALEMBIC_CFG_PATH_TRACING: %s", env.alembic.cfg_path_tracing)
logger.info("alembic_cfg: %s", alembic_cfg)
logger.info("script: %s", script)


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
    required_tables = ["spans"]
    existing_tables = inspector.get_table_names()

    # Check if all required tables exist in the database
    all_tables_exist = all(table in existing_tables for table in required_tables)

    return not all_tables_exist


async def get_current_migration_head_from_db(engine: AsyncEngine):
    """
    Checks the alembic_version table to get the current migration head that has been applied.

    Args:
        engine (Engine): The engine that connects to an sqlalchemy pool

    Returns:
        the current migration head (where 'head' is the revision stored in the migration script)
    """

    async with engine.connect() as connection:
        try:
            result = await connection.execute(
                text("SELECT version_num FROM alembic_version")
            )  # type: ignore
        except (asyncpg.exceptions.UndefinedTableError, ProgrammingError):
            # Note: If the alembic_version table does not exist, it will result in raising an UndefinedTableError exception.
            # We need to suppress the error and return a list with the alembic_version table name to inform the user that there is a pending migration \
            # to make Alembic start tracking the migration changes.
            # --------------------------------------------------------------------------------------
            # This effect (the exception raising) happens for both users (first-time and returning)
            return "alembic_version"

        migration_heads = [row[0] for row in result.fetchall()]
        assert len(migration_heads) == 1, (
            "There can only be one migration head stored in the database."
        )
        return migration_heads[0]


async def get_pending_migration_head():
    """
    Gets the migration head that have not been applied.

    Returns:
        the pending migration head
    """

    engine = create_async_engine(url=env.postgres.uri_tracing)
    try:
        current_migration_script_head = script.get_current_head()
        migration_head_from_db = await get_current_migration_head_from_db(engine=engine)

        pending_migration_head = []
        if current_migration_script_head != migration_head_from_db:
            pending_migration_head.append(current_migration_script_head)
        if "alembic_version" == migration_head_from_db:
            pending_migration_head.append("alembic_version")
    finally:
        await engine.dispose()

    return pending_migration_head


def run_alembic_migration():
    """
    Applies migration for first-time users and also checks the environment variable
    "ALEMBIC_AUTO_MIGRATIONS" (legacy: "AGENTA_AUTO_MIGRATIONS") to determine whether
    to apply migrations for returning users.
    """

    try:
        pending_migration_head = asyncio.run(get_pending_migration_head())
        FIRST_TIME_USER = True if "alembic_version" in pending_migration_head else False

        if FIRST_TIME_USER or env.agenta.auto_migrations:
            command.upgrade(alembic_cfg, "head")
            click.echo(
                click.style(
                    "\nMigration applied successfully. The container will now exit.",
                    fg="green",
                ),
                color=True,
            )
        else:
            click.echo(
                click.style(
                    "\nAll migrations are up-to-date. The container will now exit.",
                    fg="yellow",
                ),
                color=True,
            )
    except Exception as e:
        click.echo(
            click.style(
                f"\nAn ERROR occurred while applying migration: {traceback.format_exc()}\nThe container will now exit.",
                fg="red",
            ),
            color=True,
        )
        raise e


async def check_for_new_migrations():
    """
    Checks for new migrations and notify the user.
    """

    pending_migration_head = await get_pending_migration_head()
    if len(pending_migration_head) >= 1 and isinstance(pending_migration_head[0], str):
        click.echo(
            click.style(
                f"\nWe have detected that there are pending database migrations {pending_migration_head} that need to be applied to keep the application up to date. To ensure the application functions correctly with the latest updates, please follow the guide here => https://agenta.ai/docs/self-host/migration/applying-schema-migration\n",
                fg="yellow",
            ),
            color=True,
        )
    return


def unique_constraint_exists(
    engine: Engine, table_name: str, constraint_name: str
) -> bool:
    """
    The function checks if a unique constraint with a specific name exists on a table in a PostgreSQL
    database.

    Args:
        - engine (Engine): instance of a database engine that represents a connection to a database.
        - table_name (str): name of the table to check the existence of the unique constraint.
        - constraint_name (str): name of the unique constraint to check for existence.

    Returns:
        - returns a boolean value indicating whether a unique constraint with the specified `constraint_name` exists in the table.
    """

    with engine.connect() as conn:
        result = conn.execute(
            text(
                f"""
        SELECT conname FROM pg_constraint
        WHERE conname = '{constraint_name}' AND conrelid = '{table_name}'::regclass;
        """
            )
        )
        return result.fetchone() is not None
