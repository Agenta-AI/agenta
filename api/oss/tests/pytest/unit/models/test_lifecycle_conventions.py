"""Convention tests for the lifecycle/FK standard.

Every table with lifecycle columns has all six, fully nullable, and the
actor (*_by_id) columns never carry FKs. See
docs/designs/oss-ee-convergence/db-integrity-audit.md.
"""

import importlib

import pytest

from oss.src.dbs.postgres.shared.base import Base

MODULES = [
    "oss.src.models.db_models",
    "oss.src.dbs.postgres.users.dbes",
    "oss.src.dbs.postgres.folders.dbes",
    "oss.src.dbs.postgres.secrets.dbes",
    "oss.src.dbs.postgres.gateway.connections.dbes",
    "oss.src.dbs.postgres.events.dbes",
    "oss.src.dbs.postgres.webhooks.dbes",
    "oss.src.dbs.postgres.tracing.dbes",
    "oss.src.dbs.postgres.testcases.dbes",
    "oss.src.dbs.postgres.testsets.dbes",
    "oss.src.dbs.postgres.queries.dbes",
    "oss.src.dbs.postgres.workflows.dbes",
    "oss.src.dbs.postgres.environments.dbes",
    "oss.src.dbs.postgres.evaluations.dbes",
]

LIFECYCLE = (
    "created_at",
    "updated_at",
    "deleted_at",
    "created_by_id",
    "updated_by_id",
    "deleted_by_id",
)
ACTORS = ("created_by_id", "updated_by_id", "deleted_by_id")


@pytest.fixture(scope="module", autouse=True)
def _register_tables():
    for module in MODULES:
        importlib.import_module(module)


def test_lifecycle_columns_complete_and_nullable():
    for table in Base.metadata.tables.values():
        columns = set(table.columns.keys())
        if not columns & set(LIFECYCLE):
            continue
        missing = set(LIFECYCLE) - columns
        assert not missing, f"{table.name} is missing lifecycle columns: {missing}"
        for name in LIFECYCLE:
            assert table.columns[name].nullable, f"{table.name}.{name} must be nullable"


def test_lifecycle_actor_columns_carry_no_fks():
    for table in Base.metadata.tables.values():
        for name in ACTORS:
            if name in table.columns:
                assert not table.columns[name].foreign_keys, (
                    f"{table.name}.{name} must not have a foreign key"
                )
