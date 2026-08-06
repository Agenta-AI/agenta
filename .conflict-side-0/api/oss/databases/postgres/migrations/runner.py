import asyncio

from oss.databases.postgres.migrations.utils import (
    split_core_and_tracing,
    copy_nodes_from_core_to_tracing,
)
from oss.databases.postgres.migrations.core.utils import (
    run_alembic_migration as migrate_core,
)
from oss.databases.postgres.migrations.core_oss.utils import (
    run_alembic_migration as migrate_core_oss,
)
from oss.databases.postgres.migrations.tracing.utils import (
    run_alembic_migration as migrate_tracing,
)
from oss.databases.postgres.migrations.tracing_oss.utils import (
    run_alembic_migration as migrate_tracing_oss,
)


if __name__ == "__main__":
    asyncio.run(split_core_and_tracing())
    migrate_core()
    migrate_core_oss()
    migrate_tracing()
    migrate_tracing_oss()
    asyncio.run(copy_nodes_from_core_to_tracing())
