import asyncio
import sys

import click

from entrypoints.memberships_check import run_materialize
from oss.src.dbs.postgres.shared.engine import get_transactions_engine
from oss.src.utils.env import env

from ee.databases.postgres.migrations.utils import (
    LEGACY_ALIGN_REVISION,
    LEGACY_REVISION_REFUSAL,
    split_core_and_tracing,
    copy_nodes_from_core_to_tracing,
    read_legacy_core_revisions,
    is_open_source_database,
)
from ee.databases.postgres.migrations.core.utils import (
    run_alembic_migration as migrate_core,
)

# The shared post-alignment chain lives in the oss tree (EE images ship both).
from oss.databases.postgres.migrations.core_oss.utils import (
    run_alembic_migration as migrate_core_oss,
)
from ee.databases.postgres.migrations.core_ee.utils import (
    run_alembic_migration as migrate_core_ee,
)
from ee.databases.postgres.migrations.tracing.utils import (
    run_alembic_migration as migrate_tracing,
)

# The shared post-alignment tracing chain lives in the oss tree (EE ships both).
from oss.databases.postgres.migrations.tracing_oss.utils import (
    run_alembic_migration as migrate_tracing_oss,
)
from ee.databases.postgres.migrations.tracing_ee.utils import (
    run_alembic_migration as migrate_tracing_ee,
)


def _legacy_core_chain_needed() -> bool:
    """Decide from the core database alone, before any step changes it.

    The open source and EE legacy chains differ before `park00000000`, so a
    database below it cannot be upgraded safely by either one here.
    """

    revisions = asyncio.run(read_legacy_core_revisions())
    if revisions is None:
        return True
    if revisions == [LEGACY_ALIGN_REVISION]:
        return False

    click.echo(
        click.style(
            LEGACY_REVISION_REFUSAL.format(revisions=", ".join(revisions) or "none"),
            fg="red",
        ),
        err=True,
        color=True,
    )
    sys.exit(1)


async def _materialize_memberships() -> None:
    try:
        result = await run_materialize()
    finally:
        await get_transactions_engine().close()
    click.echo(
        f"Project memberships written: inserted={result['inserted']}"
        f" updated={result['updated']}"
    )


def main() -> None:
    legacy_core_chain_needed = _legacy_core_chain_needed()

    asyncio.run(split_core_and_tracing())
    if legacy_core_chain_needed:
        migrate_core()
    migrate_core_oss()
    # An open source database reads membership from the organization row. The
    # EE code reads project rows, so write them before core_ee runs. Because
    # core_ee runs after, an interrupted start repeats this step, which is safe.
    # The membership step needs the core_oss head, so with automatic migrations
    # off the database stays open source until a start with them on.
    open_source = asyncio.run(is_open_source_database())
    if open_source and not env.alembic.auto_migrations:
        click.echo(
            click.style(
                "\nOpen source database: auto-migrations disabled, skipping"
                " the membership step and the alembic_version_ee chain.",
                fg="yellow",
            ),
            color=True,
        )
    else:
        if open_source:
            asyncio.run(_materialize_memberships())
        migrate_core_ee()
    migrate_tracing()
    migrate_tracing_oss()
    migrate_tracing_ee()
    asyncio.run(copy_nodes_from_core_to_tracing())


if __name__ == "__main__":
    main()
