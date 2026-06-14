import asyncio
import logging
import traceback
from pathlib import Path

import click
from alembic import command
from alembic.config import Config
from sqlalchemy import text
from sqlalchemy.ext.asyncio import create_async_engine

from oss.src.utils.env import env

logger = logging.getLogger("alembic.env")

# The legacy tracing chain must be parked at the align revision before this runs.
ALIGN_REVISION = "park00000000"
VERSION_TABLE = "alembic_version_tracing_oss"

_HERE = Path(__file__).parent

# Config path derived from the module location: works in containers and
# locally, and cannot be misconfigured into running the wrong chain.
alembic_cfg = Config(str(_HERE / "alembic.ini"))
alembic_cfg.set_main_option("script_location", str(_HERE))

logger.info("migrations: alembic_version_tracing_oss chain")


async def _fetch_value(query: str):
    engine = create_async_engine(url=env.postgres.uri_tracing)
    try:
        async with engine.connect() as connection:
            result = await connection.execute(text(query))
            row = result.first()
            return row[0] if row else None
    finally:
        await engine.dispose()


async def _assert_legacy_parked() -> None:
    exists = await _fetch_value(
        "SELECT to_regclass('public.alembic_version') IS NOT NULL"
    )
    if not exists:
        raise RuntimeError(
            "legacy tracing alembic_version table not found; the legacy tracing"
            " chain must run first"
        )
    head = await _fetch_value("SELECT version_num FROM alembic_version")
    if head != ALIGN_REVISION:
        raise RuntimeError(
            f"legacy tracing chain is at {head!r}, expected the align revision"
            f" {ALIGN_REVISION!r}; upgrade the legacy tracing chain first"
        )


async def _is_first_run() -> bool:
    exists = await _fetch_value(
        f"SELECT to_regclass('public.{VERSION_TABLE}') IS NOT NULL"
    )
    return not exists


def run_alembic_migration():
    """Run the alembic_version_tracing_oss chain to head (legacy tracing chain must be parked at align)."""

    try:
        asyncio.run(_assert_legacy_parked())

        first_run = asyncio.run(_is_first_run())
        if first_run or env.alembic.auto_migrations:
            command.upgrade(alembic_cfg, "head")
            click.echo(
                click.style(
                    "\nalembic_version_tracing_oss chain migrations applied.",
                    fg="green",
                ),
                color=True,
            )
        else:
            click.echo(
                click.style(
                    "\nalembic_version_tracing_oss chain: auto-migrations disabled, skipping.",
                    fg="yellow",
                ),
                color=True,
            )
    except Exception as e:
        click.echo(
            click.style(
                f"\nAn ERROR occurred while applying alembic_version_tracing_oss chain migrations:"
                f" {traceback.format_exc()}",
                fg="red",
            ),
            color=True,
        )
        raise e
