"""Alembic environment for the Agenta Local SQLite database.

The database path is passed programmatically via ``config.attributes["database_path"]``
(set by ``runner.py``); no environment variables are consulted.
"""

from pathlib import Path

from agenta_local.dbs.sqlite.agents import dbes as _agents_dbes  # noqa: F401
from agenta_local.dbs.sqlite.sessions import dbes as _sessions_dbes  # noqa: F401
from agenta_local.dbs.sqlite.shared.base import Base
from alembic import context
from sqlalchemy import pool

config = context.config

database_path: Path = config.attributes["database_path"]
target_metadata = Base.metadata


def run_migrations_offline() -> None:
    context.configure(
        url=f"sqlite:///{database_path}",
        target_metadata=target_metadata,
        literal_binds=True,
        render_as_batch=True,
    )
    with context.begin_transaction():
        context.run_migrations()


def run_migrations_online() -> None:
    from sqlalchemy import create_engine

    connectable = create_engine(
        f"sqlite:///{database_path}",
        poolclass=pool.NullPool,
    )
    with connectable.connect() as connection:
        context.configure(
            connection=connection,
            target_metadata=target_metadata,
            render_as_batch=True,
        )
        with context.begin_transaction():
            context.run_migrations()


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
