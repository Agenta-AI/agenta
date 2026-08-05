"""EE counterpart of the lifecycle/FK convention tests (EE-only tables)."""

import importlib

import pytest

from oss.src.dbs.postgres.shared.base import Base

MODULES = [
    "ee.src.dbs.postgres.subscriptions.dbes",
    "ee.src.dbs.postgres.meters.dbes",
    "ee.src.dbs.postgres.organizations.dbes",
]

EE_TABLES = (
    "subscriptions",
    "meters",
    "organization_domains",
    "organization_providers",
)

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


def test_ee_lifecycle_columns_complete_and_nullable():
    for name in EE_TABLES:
        table = Base.metadata.tables[name]
        missing = set(LIFECYCLE) - set(table.columns.keys())
        assert not missing, f"{name} is missing lifecycle columns: {missing}"
        for column in LIFECYCLE:
            assert table.columns[column].nullable, f"{name}.{column} must be nullable"


def test_ee_lifecycle_actor_columns_carry_no_fks():
    for name in EE_TABLES:
        table = Base.metadata.tables[name]
        for column in ACTORS:
            assert not table.columns[column].foreign_keys, (
                f"{name}.{column} must not have a foreign key"
            )


def test_billing_fks_anchor_to_organizations():
    meters = Base.metadata.tables["meters"]
    targets = {
        fk.target_fullname for fk in meters.columns["organization_id"].foreign_keys
    }
    assert targets == {"organizations.id"}

    subscriptions = Base.metadata.tables["subscriptions"]
    targets = {
        fk.target_fullname
        for fk in subscriptions.columns["organization_id"].foreign_keys
    }
    assert targets == {"organizations.id"}
