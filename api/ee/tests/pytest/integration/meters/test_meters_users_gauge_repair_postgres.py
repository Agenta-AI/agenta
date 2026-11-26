"""Revision `ee0000000011` (the members gauge that OSS adoption and the admin endpoint
left unreadable) on a real Postgres.

`ee0000000002` wrote the gauge with `year = 0`, `month = 0` and a random id, where every
reader looks for no period and the `compute_meter_id` id: the Usage tab read 0 members.
Each case seeds its own organization and limits the walk to it.
"""

import functools
import importlib.util
from pathlib import Path
from types import SimpleNamespace
from uuid import uuid4

import pytest

from ee.src.core.meters.types import MeterPeriod, MeterScope, Meters
from ee.src.dbs.postgres.meters.dao import MetersDAO
from ee.src.dbs.postgres.subscriptions.dbes import SubscriptionDBE  # noqa: F401
from oss.src.dbs.postgres.shared.engine import get_transactions_engine
from oss.tests.pytest.utils.membership_seed import (
    delete_seeded_organization,
    execute,
    fetch_all,
    seed_organization,
)


pytestmark = pytest.mark.integration

_VERSIONS = (
    Path(__file__).resolve().parents[4]
    / "databases/postgres/migrations/core_ee/versions"
)


@functools.lru_cache(maxsize=1)
def _revision():
    path = _VERSIONS / "ee0000000011_repair_users_gauge.py"
    spec = importlib.util.spec_from_file_location("_revision_ee011", path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


async def _run(organization_ids):
    engine = get_transactions_engine()._engine
    async with engine.connect() as connection:
        connection = await connection.execution_options(isolation_level="AUTOCOMMIT")
        return await connection.run_sync(
            lambda sync: _revision().run(sync, organization_ids=organization_ids)
        )


async def _insert_adopted(org, value):
    """The row `ee0000000002` writes."""
    await execute(
        "INSERT INTO meters (meter_id, key, value, synced, organization_id, year, month) "
        "VALUES (:id, CAST('USERS' AS meters_type), :v, 0, :o, 0, 0)",
        {"id": uuid4(), "v": value, "o": org},
    )


async def _users_rows(org):
    return await fetch_all(
        "SELECT meter_id, year, month, day, value FROM meters "
        "WHERE organization_id = :o AND key = CAST('USERS' AS meters_type)",
        {"o": org},
    )


async def _members_read(org):
    """What the Usage tab reads: the gauge row with no period."""
    rows = await MetersDAO().fetch(
        scope=MeterScope(organization_id=org),
        key=Meters.USERS,
        period=MeterPeriod(),
    )
    return rows[0].value if rows else 0


@pytest.fixture
async def org():
    seeded = await seed_organization(members={"m": "editor"})
    yield SimpleNamespace(id=seeded.organization_id)
    await delete_seeded_organization(seeded)


def test_ee011_follows_ee010():
    revision = _revision()
    assert (revision.revision, revision.down_revision) == (
        "ee0000000011",
        "ee0000000010",
    )


async def test_ee011_makes_the_adopted_gauge_readable(org):
    await _insert_adopted(org.id, value=2)
    assert await _members_read(org.id) == 0

    assert await _run([org.id]) == {"moved": 1, "added": 0}

    rows = await _users_rows(org.id)
    assert len(rows) == 1
    assert rows[0]["meter_id"] == _revision().users_gauge_id(org.id)
    assert (rows[0]["year"], rows[0]["month"], rows[0]["day"]) == (None, None, None)
    assert await _members_read(org.id) == 2


async def test_ee011_adds_members_invited_after_adoption(org):
    await _insert_adopted(org.id, value=2)
    # One invite after adoption started the reader's row at 1.
    await execute(
        "INSERT INTO meters (meter_id, key, value, synced, organization_id) "
        "VALUES (:id, CAST('USERS' AS meters_type), 1, 0, :o)",
        {"id": _revision().users_gauge_id(org.id), "o": org.id},
    )

    await _run([org.id])

    assert len(await _users_rows(org.id)) == 1
    assert await _members_read(org.id) == 3


async def test_ee011_is_idempotent(org):
    await _insert_adopted(org.id, value=2)
    await _run([org.id])
    assert await _run([org.id]) == {"moved": 0, "added": 0}
    assert await _members_read(org.id) == 2


async def test_ee011_counts_the_members_of_an_organization_with_no_gauge(org):
    # The seeded organization has an owner and one member and no gauge row, like an
    # organization the admin endpoint created.
    assert await _members_read(org.id) == 0

    assert await _run([org.id]) == {"moved": 0, "added": 1}

    assert await _members_read(org.id) == 2
    assert await _run([org.id]) == {"moved": 0, "added": 0}
