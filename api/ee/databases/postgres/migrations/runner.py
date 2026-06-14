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

# The shared post-alignment tracing chain lives in the oss tree (EE ships both).
from oss.databases.postgres.migrations.tracing_oss.utils import (
    run_alembic_migration as migrate_tracing_oss,
)
from ee.databases.postgres.migrations.tracing_ee.utils import (
    run_alembic_migration as migrate_tracing_ee,
)


if __name__ == "__main__":
    asyncio.run(split_core_and_tracing())
    migrate_core()
    migrate_core_oss()
    migrate_core_ee()
    migrate_tracing()
    migrate_tracing_oss()
    migrate_tracing_ee()
    asyncio.run(copy_nodes_from_core_to_tracing())
