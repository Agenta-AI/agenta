import asyncio
from logging.config import fileConfig

from sqlalchemy import pool
from sqlalchemy.engine import Connection
from sqlalchemy.ext.asyncio import async_engine_from_config

from alembic import context

from oss.src.dbs.postgres.shared.config import POSTGRES_URI_CORE
from oss.src.dbs.postgres.shared.base import Base

# Side-effect imports: register SQLAlchemy models with Base.metadata
# so Alembic autogenerate can discover them.
import oss.src.dbs.postgres.environments.dbes  # noqa: F401
import oss.src.dbs.postgres.evaluations.dbes  # noqa: F401
import oss.src.dbs.postgres.folders.dbes  # noqa: F401
import oss.src.dbs.postgres.queries.dbes  # noqa: F401
import oss.src.dbs.postgres.secrets.dbes  # noqa: F401
import oss.src.dbs.postgres.testcases.dbes  # noqa: F401
import oss.src.dbs.postgres.testsets.dbes  # noqa: F401
import oss.src.dbs.postgres.users.dbes  # noqa: F401
import oss.src.dbs.postgres.workflows.dbes  # noqa: F401


# this is the Alembic Config object, which provides
# access to the values within the .ini file in use.
config = context.config
config.set_main_option("sqlalchemy.url", POSTGRES_URI_CORE)  # type: ignore


# Interpret the config file for Python logging.
# This line sets up loggers basically.
if config.config_file_name is not None:
    fileConfig(config.config_file_name)

target_metadata = Base.metadata

# other values from the config, defined by the needs of env.py,
# can be acquired:
# my_important_option = config.get_main_option("my_important_option")
# ... etc.


def run_migrations_offline() -> None:
    """Run migrations in 'offline' mode.
    This configures the context with just a URL
    and not an Engine, though an Engine is acceptable
    here as well.  By skipping the Engine creation
    we don't even need a DBAPI to be available.
    Calls to context.execute() here emit the given string to the
    script output.
    """
    url = config.get_main_option("sqlalchemy.url")
    context.configure(
        url=url,
        transaction_per_migration=True,
        target_metadata=target_metadata,
        literal_binds=True,
        dialect_opts={"paramstyle": "named"},
    )

    with context.begin_transaction():
        context.run_migrations()


def do_run_migrations(connection: Connection) -> None:
    context.configure(
        transaction_per_migration=True,
        connection=connection,
        target_metadata=target_metadata,
    )

    with context.begin_transaction():
        context.run_migrations()


async def run_async_migrations() -> None:
    """In this scenario we need to create an Engine
    and associate a connection with the context.
    """

    connectable = async_engine_from_config(
        config.get_section(config.config_ini_section, {}),
        prefix="sqlalchemy.",
        poolclass=pool.NullPool,
    )

    async with connectable.connect() as connection:
        await connection.run_sync(do_run_migrations)

    await connectable.dispose()


def run_migrations_online() -> None:
    """Run migrations in 'online' mode."""

    asyncio.run(run_async_migrations())


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
