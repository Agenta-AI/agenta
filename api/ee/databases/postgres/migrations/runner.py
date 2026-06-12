import asyncio

from ee.databases.postgres.migrations.utils import (
    split_core_and_tracing,
    copy_nodes_from_core_to_tracing,
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


if __name__ == "__main__":
    asyncio.run(split_core_and_tracing())
    migrate_core()
    migrate_core_oss()
    migrate_core_ee()
    migrate_tracing()
    asyncio.run(copy_nodes_from_core_to_tracing())
