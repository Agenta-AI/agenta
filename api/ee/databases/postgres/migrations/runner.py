import asyncio

from ee.databases.postgres.migrations.utils import (
    split_core_and_tracing,
    copy_nodes_from_core_to_tracing,
)
from ee.databases.postgres.migrations.core.utils import (
    run_alembic_migration as migrate_core,
)
from ee.databases.postgres.migrations.tracing.utils import (
    run_alembic_migration as migrate_tracing,
)


if __name__ == "__main__":
    asyncio.run(split_core_and_tracing())
    migrate_core()
    migrate_tracing()
    asyncio.run(copy_nodes_from_core_to_tracing())
