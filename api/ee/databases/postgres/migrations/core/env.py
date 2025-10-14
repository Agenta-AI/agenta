import os
import asyncio
from logging.config import fileConfig

from sqlalchemy import pool
from sqlalchemy.engine import Connection, create_engine
from sqlalchemy.ext.asyncio import async_engine_from_config, create_async_engine

from alembic import context

from oss.src.dbs.postgres.shared.engine import engine


# this is the Alembic Config object, which provides
# access to the values within the .ini file in use.
config = context.config
config.set_main_option("sqlalchemy.url", engine.postgres_uri_core)  # type: ignore


# Interpret the config file for Python logging.
# This line sets up loggers basically.
if config.config_file_name is not None:
    fileConfig(config.config_file_name)

# add your model's MetaData object here
# for 'autogenerate' support
from oss.src.dbs.postgres.shared.base import Base

import oss.src.dbs.postgres.secrets.dbes
import oss.src.dbs.postgres.observability.dbes
import oss.src.dbs.postgres.tracing.dbes
import oss.src.dbs.postgres.testcases.dbes
import oss.src.dbs.postgres.testsets.dbes
import oss.src.dbs.postgres.queries.dbes
import oss.src.dbs.postgres.workflows.dbes
import oss.src.dbs.postgres.evaluations.dbes

import ee.src.dbs.postgres.meters.dbes
import ee.src.dbs.postgres.subscriptions.dbes


# from myapp import mymodel
# target_metadata = mymodel.Base.metadata
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
    connection = create_engine(
        url=config.get_main_option("sqlalchemy.url"),
        pool_size=10,  # Maintain 10 connections in the pool
        pool_timeout=43200,  # Timeout of 12 hours
        pool_recycle=43200,  # Timeout of 12 hours
        pool_pre_ping=True,
        echo_pool=True,
        pool_use_lifo=True,
    )
    context.configure(
        connection=connection,
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

    connectable = create_async_engine(
        url=config.get_main_option("sqlalchemy.url"),
        pool_size=10,  # Maintain 10 connections in the pool
        pool_timeout=43200,  # Timeout of 12 hours
        pool_recycle=43200,  # Timeout of 12 hours
        pool_pre_ping=True,
        echo_pool=True,
        pool_use_lifo=True,
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
