import asyncio

from oss.databases.postgres.migrations.utils import (
    split_core_and_tracing,
    copy_nodes_from_core_to_tracing,
)
from oss.databases.postgres.migrations.core.utils import (
    run_alembic_migration as migrate_core,
)
from oss.databases.postgres.migrations.tracing.utils import (
    run_alembic_migration as migrate_tracing,
)


if __name__ == "__main__":
    loop = asyncio.get_event_loop()

    loop.run_until_complete(split_core_and_tracing())
    migrate_core()
    migrate_tracing()
    loop.run_until_complete(copy_nodes_from_core_to_tracing())
